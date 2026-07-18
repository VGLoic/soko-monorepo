use crate::newtypes::email::Email;

/// Email service trait for email operations
#[async_trait::async_trait]
pub trait EmailService: Send + Sync + 'static {
    /// Send an email to a target email with the input content
    /// # Arguments
    /// * `email` email to send to
    /// * `content` email content
    /// # Errors
    /// * `anyhow::Error` for any errors that may occur during the process
    async fn send_email(&self, email: Email, content: String) -> Result<(), anyhow::Error>;
}

pub struct DummyEmailSender;

#[async_trait::async_trait]
impl EmailService for DummyEmailSender {
    async fn send_email(&self, _: Email, _: String) -> Result<(), anyhow::Error> {
        Ok(())
    }
}
