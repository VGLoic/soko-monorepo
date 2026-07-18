#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OtpRequest {
    pub id: uuid::Uuid,
    pub user_id: uuid::Uuid,
    pub otp_hash: [u8; 32],
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}
