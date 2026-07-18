use serde::{Deserialize, Serialize};

use crate::{
    newtypes::{email::Email, handle::Handle},
    users::models::user::User,
};

#[derive(Serialize, Deserialize, Debug)]
pub enum UsersJob {
    SendEmailVerificationOtp(SendEmailVerificationOtpPayload),
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SendEmailVerificationOtpPayload {
    pub user_id: uuid::Uuid,
    pub user_email: Email,
    pub user_handle: Handle,
}

impl SendEmailVerificationOtpPayload {
    pub fn new(user: &User) -> Self {
        Self {
            user_id: user.id,
            user_email: user.email.to_owned(),
            user_handle: user.handle.clone(),
        }
    }
}
