use chrono::Utc;
use tracing::{debug, info};

use crate::{
    jobs::{
        job::JobRequest,
        queue::{Queue, QueueError},
    },
    users::{
        models::{
            auth_credential::AuthCredential, email_signup::EmailSignupError, user::User,
            verify_email::VerifyEmailError,
        },
        notifier::jobs::{SendEmailVerificationOtpPayload, UsersJob},
    },
};

pub mod job_processor;
pub mod jobs;

pub const USERS_JOB_TOPIC: &str = "users";

#[async_trait::async_trait]
/// Defines the UsersNotifier trait for users related notifications
pub trait UsersNotifier: Send + Sync + 'static {
    /// Triggers a notification when user signed up with email
    /// # Errors
    /// * `EmailSignupError::Unknown` for any errors that may occur during the process.
    async fn user_signed_up_with_email(
        &self,
        user: &User,
        auth_credential: &AuthCredential,
    ) -> Result<(), EmailSignupError>;

    /// Triggers a notification when user verified their email
    /// # Errors
    /// * `VerifyEmailError::Unknown` for any errors that may occur during the process
    async fn user_verified_email(&self, user: &User) -> Result<(), VerifyEmailError>;
}

#[derive(Clone)]
pub struct UsersNotifierImpl<Q: Queue> {
    queue: Q,
}

impl<Q: Queue> UsersNotifierImpl<Q> {
    pub fn new(queue: Q) -> Self {
        Self { queue }
    }
}

#[async_trait::async_trait]
impl<Q: Queue> UsersNotifier for UsersNotifierImpl<Q> {
    async fn user_signed_up_with_email(
        &self,
        user: &User,
        _auth_credential: &AuthCredential,
    ) -> Result<(), EmailSignupError> {
        debug!(
            "sending notification for user signed up with email: {}",
            user.email
        );
        let job = JobRequest::new(
            USERS_JOB_TOPIC.to_string(),
            UsersJob::SendEmailVerificationOtp(SendEmailVerificationOtpPayload::new(user)),
        )?
        .with_max_retries(3)
        .with_scheduled_at(Utc::now());
        self.queue.enqueue(job).await?;

        info!(
            "sent notification for user signed up with email: {}",
            user.email
        );
        Ok(())
    }

    async fn user_verified_email(&self, user: &User) -> Result<(), VerifyEmailError> {
        debug!(
            "sending notification for user verified email: {}",
            user.email
        );

        info!("sent notification for user verified email: {}", user.email);
        Ok(())
    }
}

impl From<QueueError> for EmailSignupError {
    fn from(value: QueueError) -> Self {
        match value {
            QueueError::Unknown(e) => EmailSignupError::Unknown(e),
        }
    }
}
