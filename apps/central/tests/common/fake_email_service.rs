use std::sync::{Arc, Mutex};

use ethoko_central::{externalcom::email::EmailService, newtypes::email::Email};

#[derive(Debug, Clone)]
pub struct FakeEmailService {
    pub emails_sent: Arc<Mutex<Vec<(Email, String)>>>,
}

impl Default for FakeEmailService {
    fn default() -> Self {
        Self {
            emails_sent: Arc::new(Mutex::new(vec![])),
        }
    }
}

impl FakeEmailService {
    #[allow(dead_code)]
    pub fn has_sent_email_to(&self, email: &Email) -> bool {
        let emails_sent = self
            .emails_sent
            .lock()
            .map_err(|e| anyhow::anyhow!("{e}").context("failed to acquire lock for emails_sent"))
            .unwrap();
        emails_sent.iter().any(|(e, _)| e == email)
    }
}

#[async_trait::async_trait]
impl EmailService for FakeEmailService {
    async fn send_email(&self, email: Email, content: String) -> Result<(), anyhow::Error> {
        let mut emails_sent = self.emails_sent.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire lock for emails_sent")
        })?;
        emails_sent.push((email, content));
        Ok(())
    }
}
