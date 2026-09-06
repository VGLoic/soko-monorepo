#[derive(Debug, Clone, sqlx::Type)]
#[sqlx(rename_all = "snake_case", type_name = "otp_purpose")]
pub enum OtpPurpose {
    EmailVerification,
    PasswordReset,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OtpRequest {
    pub id: uuid::Uuid,
    pub user_id: uuid::Uuid,
    pub otp_hash: [u8; 32],
    pub purpose: OtpPurpose,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}
