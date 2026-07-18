use crate::{
    config::OtpConfig,
    externalcom::email::EmailService,
    jobs::{job::Job, processor::JobProcessor},
    users::{
        notifier::jobs::{SendEmailVerificationOtpPayload, UsersJob},
        otp,
        repository::AuthRepository,
    },
};
use tracing::{error, info};

#[derive(Debug, Clone)]
pub struct UsersJobProcessor<R: AuthRepository, E: EmailService> {
    auth_repository: R,
    email_service: E,
    otp_config: OtpConfig,
}
impl<R: AuthRepository, E: EmailService> UsersJobProcessor<R, E> {
    pub fn new(auth_repository: R, email_service: E, otp_config: OtpConfig) -> Self {
        Self {
            auth_repository,
            email_service,
            otp_config,
        }
    }
}

#[async_trait::async_trait]
impl<R: AuthRepository, E: EmailService> JobProcessor for UsersJobProcessor<R, E> {
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error> {
        info!("start processing job {}", job.id);

        let payload: UsersJob = serde_json::from_str(&job.payload)
            .map_err(|e| anyhow::Error::new(e).context("failed to deserialized job payload"))?;

        match payload {
            UsersJob::SendEmailVerificationOtp(p) => {
                self.process_send_email_verification_otp(p)
                    .await
                    .map_err(|e| {
                        anyhow::anyhow!(e).context("failed to send email verification OTP")
                    })?;
                Ok(())
            }
        }
        .map_err(|e| {
            error!("failed to process job: {e}");
            e
        })
    }
}

impl<R: AuthRepository, E: EmailService> UsersJobProcessor<R, E> {
    async fn process_send_email_verification_otp(
        &self,
        payload: SendEmailVerificationOtpPayload,
    ) -> Result<(), anyhow::Error> {
        let otp = otp::Otp::generate()?;

        let content = format!("OTP: {}", otp.show());
        self.email_service
            .send_email(payload.user_email, content)
            .await
            .map_err(|e| e.context("failed to send email verification OTP"))?;

        self.auth_repository
            .register_email_verification_otp(payload.user_id, otp.hash(), &self.otp_config)
            .await?;

        info!(
            "Email verification OTP sent to user with ID {}",
            payload.user_id
        );

        Ok(())
    }
}
