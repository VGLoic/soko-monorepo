use crate::users::{
    models::{
        auth_credential::AuthCredential,
        email_signup::{EmailSignupError, EmailSignupRequest},
        user::User,
        verify_email::{VerifyEmailError, VerifyEmailRequest},
    },
    notifier::UsersNotifier,
    repository::AuthRepository,
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
}

#[derive(Clone)]
pub struct AuthServiceImpl<R: AuthRepository, N: UsersNotifier> {
    repository: R,
    notifier: N,
}

impl<R: AuthRepository, N: UsersNotifier> AuthServiceImpl<R, N> {
    pub fn new(repository: R, notifier: N) -> Self {
        Self {
            repository,
            notifier,
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
}
