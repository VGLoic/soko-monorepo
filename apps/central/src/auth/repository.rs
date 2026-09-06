use crate::{
    auth::models::{
        auth_credential::AuthCredential,
        otp_request::{OtpPurpose, OtpRequest},
        requests::{
            email_signup::{EmailSignupError, EmailSignupRequest},
            send_email_verification_otp::SendEmailVerificationOtpError,
            verify_email::{VerifyEmailError, VerifyEmailRequest},
        },
        user::User,
    },
    config::OtpConfig,
    newtypes::email::Email,
};
use chrono::{TimeDelta, Utc};
use sqlx::{Executor, Pool, Postgres};
use thiserror::Error;

/// Repository trait for auth-related operations
#[async_trait::async_trait]
pub trait AuthRepository: Send + Sync + 'static {
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

    /// Registers a new email verification OTP for the user.
    /// - A new OTP is created for the user with the provided OTP hash.
    /// # Errors
    /// * `SendEmailVerificationOtpError::NotFound` if the user is not found.
    /// * `SendEmailVerificationOtpError::EmailAlreadyVerified` if the user's email is already verified.
    /// * `SendEmailVerificationOtpError::CooldownNotElapsed` if the cooldown period has not elapsed yet for requesting a new verification code.
    /// * `SendEmailVerificationOtpError::Unknown` for any other errors that may occur during the process.
    async fn register_email_verification_otp(
        &self,
        user_id: uuid::Uuid,
        otp_hash: [u8; 32],
        otp_config: &OtpConfig,
    ) -> Result<OtpRequest, SendEmailVerificationOtpError>;

    /// Verifies the email of the user with the provided OTP hash.
    /// - The user is fetched from the database using the provided user ID.
    /// - The latest OTP request for the user is fetched from the database.
    /// - If the OTP request is found and the provided OTP hash matches the stored OTP hash, the user's email is marked as verified.
    /// - If the OTP request is not found, the provided OTP hash does not match the stored OTP hash, or the OTP request has expired, an appropriate error is returned.
    /// - If the user's email is already verified, an error is returned
    /// # Errors
    /// * `VerifyEmailError::NotFound` if the user is not found
    /// * `VerifyEmailError::InvalidOtp` if the provided OTP is invalid
    /// * `VerifyEmailError::EmailAlreadyVerified` if the user's email is already verified
    /// * `VerifyEmailError::OtpExpired` if the provided OTP has expired
    /// * `VerifyEmailError::Unknown` for any other errors that may occur during the process.
    async fn verify_email_by_otp(
        &self,
        verify_email_request: VerifyEmailRequest,
    ) -> Result<User, VerifyEmailError>;

    /// Gets a user by their email address.
    /// # Errors
    /// * `GetUserError::NotFound` if the user is not found
    /// * `GetUserError::Unknown` for any other errors that may occur during the process.
    async fn get_user_by_email(&self, email: &Email) -> Result<User, GetUserError>;

    /// Gets the last OTP request for a user by their user ID.
    /// # Errors
    /// * `GetLastOtpRequestError::Unknown` for any other errors that may occur during the process.
    async fn get_last_otp_request_by_user_id(
        &self,
        user_id: uuid::Uuid,
    ) -> Result<Option<OtpRequest>, GetLastOtpRequestError>;
}

#[derive(Error, Debug)]
pub enum GetUserError {
    #[error("User not found")]
    NotFound,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Error, Debug)]
pub enum GetLastOtpRequestError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct PsqlAuthRepository {
    pool: Pool<Postgres>,
}

impl PsqlAuthRepository {
    pub fn new(pool: Pool<Postgres>) -> Self {
        Self { pool }
    }
}

// 23505 is the PostgreSQL error code for unique_violation
const UNIQUE_VIOLATION_ERROR_CODE: &str = "23505";
const UNIQUE_EMAIL_CONSTRAINT_NAME: &str = "unique_email";
const UNIQUE_HANDLE_CONSTRAINT_NAME: &str = "unique_handle";

#[async_trait::async_trait]
impl AuthRepository for PsqlAuthRepository {
    async fn signup_with_email(
        &self,
        request: EmailSignupRequest,
    ) -> Result<(User, AuthCredential), EmailSignupError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction"))?;

        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO "ethoko_user" (
                email,
                handle,
                email_verified
            ) VALUES ($1, $2, $3)
            RETURNING
                id,
                email,
                handle,
                email_verified,
                created_at,
                updated_at
            "#,
        )
        .bind(&request.email)
        .bind(&request.handle)
        .bind(false)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db_err) = &e
                && db_err.code() == Some(UNIQUE_VIOLATION_ERROR_CODE.into())
            {
                if db_err.message().contains(UNIQUE_EMAIL_CONSTRAINT_NAME) {
                    return EmailSignupError::EmailAlreadyExists(request.email.to_string());
                } else if db_err.message().contains(UNIQUE_HANDLE_CONSTRAINT_NAME) {
                    return EmailSignupError::HandleAlreadyExists(request.handle.to_string());
                }
            }
            anyhow::anyhow!(e).context("failed to create user").into()
        })?;

        let auth_credential = sqlx::query_as::<_, AuthCredential>(
            r#"
            INSERT INTO auth_credential (
                user_id,
                password_hash
            ) VALUES ($1, $2)
            RETURNING
                id,
                user_id,
                password_hash,
                created_at,
                updated_at
            "#,
        )
        .bind(user.id)
        .bind(request.password_hash)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to create auth credential"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok((user, auth_credential))
    }

    async fn register_email_verification_otp(
        &self,
        user_id: uuid::Uuid,
        otp_hash: [u8; 32],
        otp_config: &OtpConfig,
    ) -> Result<OtpRequest, SendEmailVerificationOtpError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction"))?;

        let user = get_user_by_id(user_id, &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user"))?;

        let user = match user {
            Some(user) => user,
            None => return Err(SendEmailVerificationOtpError::NotFound),
        };
        if user.email_verified {
            return Err(SendEmailVerificationOtpError::EmailAlreadyVerified);
        }

        let last_otp_request = get_last_otp_request_by_user_id(user_id, &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch last otp request"))?;

        if let Some(otp_request) = last_otp_request {
            let cooldown_limit = otp_request
                .created_at
                .checked_add_signed(TimeDelta::seconds(otp_config.cooldown_seconds.into()))
                .ok_or(anyhow::anyhow!("failed to compute cooldown limit"))?;
            if Utc::now() < cooldown_limit {
                return Err(SendEmailVerificationOtpError::CooldownNotElapsed);
            }
        }

        let expires_at = Utc::now()
            .checked_add_signed(TimeDelta::seconds(otp_config.ttl_seconds.into()))
            .ok_or(anyhow::anyhow!("failed to compute expires_at"))?;
        let otp_request = sqlx::query_as::<_, OtpRequest>(
            r#"
            INSERT INTO otp_request (
                user_id,
                otp_hash,
                purpose,
                expires_at
            ) VALUES ($1, $2, $3, $4)
            RETURNING
                id,
                user_id,
                otp_hash,
                purpose,
                created_at,
                expires_at
            "#,
        )
        .bind(user_id)
        .bind(otp_hash)
        .bind(OtpPurpose::EmailVerification)
        .bind(expires_at)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to create otp request"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok(otp_request)
    }

    async fn verify_email_by_otp(
        &self,
        verify_email_request: VerifyEmailRequest,
    ) -> Result<User, VerifyEmailError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction"))?;

        let user = get_user_by_email(&verify_email_request.email, &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user"))?;

        let user = match user {
            Some(user) => user,
            None => return Err(VerifyEmailError::NotFound),
        };
        if user.email_verified {
            return Err(VerifyEmailError::EmailAlreadyVerified);
        }

        let otp_request = get_last_otp_request_by_user_id(user.id, &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch last otp request"))?;

        let otp_request = match otp_request {
            Some(otp_request) => otp_request,
            None => return Err(VerifyEmailError::InvalidOtp),
        };

        if Utc::now() > otp_request.expires_at {
            return Err(VerifyEmailError::OtpExpired);
        }

        if let OtpPurpose::EmailVerification = otp_request.purpose {
        } else {
            return Err(VerifyEmailError::InvalidOtp);
        }

        if otp_request.otp_hash != verify_email_request.otp_hash {
            return Err(VerifyEmailError::InvalidOtp);
        }

        sqlx::query(
            r#"
            UPDATE "ethoko_user"
            SET email_verified = true
            WHERE id = $1
            "#,
        )
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to update user email_verified"))?;

        let updated_user = get_user_by_id(user.id, &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch updated user"))?
            .ok_or(anyhow::anyhow!("failed to fetch updated user"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok(updated_user)
    }

    async fn get_user_by_email(&self, email: &Email) -> Result<User, GetUserError> {
        let user = get_user_by_email(email, &self.pool)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user by email"))?;

        match user {
            Some(user) => Ok(user),
            None => Err(GetUserError::NotFound),
        }
    }

    async fn get_last_otp_request_by_user_id(
        &self,
        user_id: uuid::Uuid,
    ) -> Result<Option<OtpRequest>, GetLastOtpRequestError> {
        get_last_otp_request_by_user_id(user_id, &self.pool)
            .await
            .map_err(|e| {
                anyhow::anyhow!(e)
                    .context("failed to fetch last otp request")
                    .into()
            })
    }
}

async fn get_last_otp_request_by_user_id<'a, E: Executor<'a, Database = Postgres>>(
    user_id: uuid::Uuid,
    executor: E,
) -> Result<Option<OtpRequest>, sqlx::Error> {
    let otp_request = sqlx::query_as::<_, OtpRequest>(
        r#"
        SELECT
            id,
            user_id,
            otp_hash,
            purpose,
            created_at,
            expires_at
        FROM otp_request
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .fetch_optional(executor)
    .await?;

    Ok(otp_request)
}

async fn get_user_by_email<'a, E: Executor<'a, Database = Postgres>>(
    email: &Email,
    executor: E,
) -> Result<Option<User>, sqlx::Error> {
    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT
            id,
            email,
            handle,
            email_verified,
            created_at,
            updated_at
        FROM "ethoko_user"
        WHERE email = $1
        "#,
    )
    .bind(email)
    .fetch_optional(executor)
    .await?;

    Ok(user)
}

async fn get_user_by_id<'a, E: Executor<'a, Database = Postgres>>(
    user_id: uuid::Uuid,
    executor: E,
) -> Result<Option<User>, sqlx::Error> {
    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT
            id,
            email,
            handle,
            email_verified,
            created_at,
            updated_at
        FROM "ethoko_user"
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(executor)
    .await?;

    Ok(user)
}
