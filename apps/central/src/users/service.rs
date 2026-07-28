use crate::{
    config::OtpConfig,
    users::{
        models::{
            auth_credential::AuthCredential,
            email_signup::{EmailSignupError, EmailSignupRequest},
            resend_verification_otp::{ResendVerificationOtpError, ResendVerificationOtpRequest},
            user::User,
            verify_email::{VerifyEmailError, VerifyEmailRequest},
        },
        notifier::UsersNotifier,
        repository::{AuthRepository, GetLastOtpRequestError, GetUserError},
    },
};
use tracing::{error, info};

#[async_trait::async_trait]
pub trait AuthService: Send + Sync + 'static {
    /// Registers a new user with the provided email, handle and password hash.
    /// - A new user is created with the provided email and handle, the email is marked as not verified.
    /// - An `auth_credential` is created for the user with the provided password hash.
    /// # Errors
    /// * `EmailSignupError::EmailAlreadyExists` if the email is already registered.
    /// * `EmailSignupError::HandleAlreadyExists` if the handle is already taken.
    /// * `EmailSignupError::Unknown` for any other errors that may occur during the process.
    async fn signup_with_email(
        &self,
        request: EmailSignupRequest,
    ) -> Result<(User, AuthCredential), EmailSignupError>;

    /// Verifies the email of a user with the provided OTP.
    /// - If the OTP is valid and not expired, the user's email is marked as verified
    /// # Errors
    /// * `VerifyEmailError::EmailAlreadyVerified` if the email is already verified.
    /// * `VerifyEmailError::InvalidOtp` if the provided OTP is invalid.
    /// * `VerifyEmailError::OtpExpired` if the provided OTP has expired.
    /// * `VerifyEmailError::NotFound` if the user with the provided email is not found.
    /// * `VerifyEmailError::Unknown` for any other errors that may occur during the process.
    async fn verify_email(&self, request: VerifyEmailRequest) -> Result<User, VerifyEmailError>;

    /// Resends the verification OTP to the user's email.
    /// - If the user's email is already verified, an error is returned.
    /// - The service only checks the condition for resend, the actual sending of the OTP is handled by the notifier.
    /// # Errors
    /// * `ResendVerificationOtpError::UserNotFound` if the user with the provided email is not found.
    /// * `ResendVerificationOtpError::UserAlreadyVerified` if the user's email is already verified.
    /// * `ResendVerificationOtpError::CooldownNotElapsed` if the cooldown period has not elapsed yet for requesting a new verification code.
    /// * `ResendVerificationOtpError::Unknown` for any other errors that may occur during the process.
    async fn resend_verification_otp(
        &self,
        request: ResendVerificationOtpRequest,
    ) -> Result<(), ResendVerificationOtpError>;
}

#[derive(Clone)]
pub struct AuthServiceImpl<R: AuthRepository, N: UsersNotifier> {
    repository: R,
    notifier: N,
    otp_config: OtpConfig,
}

impl<R: AuthRepository, N: UsersNotifier> AuthServiceImpl<R, N> {
    pub fn new(repository: R, notifier: N, otp_config: OtpConfig) -> Self {
        Self {
            repository,
            notifier,
            otp_config,
        }
    }
}

#[async_trait::async_trait]
impl<R: AuthRepository, N: UsersNotifier> AuthService for AuthServiceImpl<R, N> {
    async fn signup_with_email(
        &self,
        request: EmailSignupRequest,
    ) -> Result<(User, AuthCredential), EmailSignupError> {
        let (user, auth_credential) = self.repository.signup_with_email(request).await?;

        if let Err(e) = self
            .notifier
            .user_signed_up_with_email(&user, &auth_credential)
            .await
        {
            error!("Error in user_signed_up_with_email notification: {:?}", e);
        }

        info!(
            "New user with ID {} signed up with email: {} and handle: {}",
            user.id, user.email, user.handle
        );

        Ok((user, auth_credential))
    }

    async fn verify_email(&self, request: VerifyEmailRequest) -> Result<User, VerifyEmailError> {
        let user = self.repository.verify_email_by_otp(request).await?;

        if let Err(e) = self.notifier.user_verified_email(&user).await {
            error!("Error in user_verified_email notification: {:?}", e);
        }

        info!(
            "User with ID {} verified their email: {}",
            user.id, user.email
        );

        Ok(user)
    }

    async fn resend_verification_otp(
        &self,
        request: ResendVerificationOtpRequest,
    ) -> Result<(), ResendVerificationOtpError> {
        let user = self
            .repository
            .get_user_by_email(&request.email)
            .await
            .map_err(|e| match e {
                GetUserError::NotFound => ResendVerificationOtpError::UserNotFound,
                GetUserError::Unknown(err) => err.context("Error fetching user by email").into(),
            })?;
        if user.email_verified {
            return Err(ResendVerificationOtpError::UserAlreadyVerified);
        }
        let last_otp = self
            .repository
            .get_last_otp_request_by_user_id(user.id)
            .await
            .map_err(|e| match e {
                GetLastOtpRequestError::Unknown(err) => {
                    err.context("Error fetching last OTP request by user ID")
                }
            })?;
        if let Some(last_otp) = last_otp {
            let now = chrono::Utc::now();
            let elapsed = now.signed_duration_since(last_otp.created_at);
            if elapsed < chrono::Duration::seconds(self.otp_config.cooldown_seconds.into()) {
                return Err(ResendVerificationOtpError::CooldownNotElapsed);
            }
        }

        if let Err(e) = self
            .notifier
            .user_requested_resend_verification_otp(&user)
            .await
        {
            error!(
                "Error in user_requested_resend_verification_otp notification: {:?}",
                e
            );
        }

        info!("Resent verification OTP to email: {}", request.email);

        Ok(())
    }
}
