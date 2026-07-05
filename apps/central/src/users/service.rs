use crate::users::{
    models::{
        auth_credential::AuthCredential,
        email_signup::{EmailSignupError, EmailSignupRequest},
        user::User,
    },
    notifier::UsersNotifier,
    repository::AuthRepository,
};
use tracing::error;

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
}

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

        Ok((user, auth_credential))
    }
}
