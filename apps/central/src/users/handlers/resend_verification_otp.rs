use crate::{
    newtypes::email::EmailError,
    router::{ApiError, AppState},
    users::models::resend_verification_otp::{
        ResendVerificationOtpBody, ResendVerificationOtpError, ResendVerificationOtpRequest,
        ResendVerificationOtpRequestError,
    },
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_resend_verification_otp(
    State(state): State<AppState>,
    Json(body): Json<ResendVerificationOtpBody>,
) -> Result<(StatusCode, Json<()>), ApiError> {
    let request = ResendVerificationOtpRequest::new(body.email)?;

    state.auth_service.resend_verification_otp(request).await?;

    Ok((StatusCode::OK, Json(())))
}

impl From<ResendVerificationOtpRequestError> for ApiError {
    fn from(err: ResendVerificationOtpRequestError) -> Self {
        match err {
            ResendVerificationOtpRequestError::InvalidEmail(e) => match e {
                EmailError::Empty => {
                    ApiError::BadRequest("\"email\": empty value not allowed".to_string())
                }
                EmailError::InvalidFormat => {
                    ApiError::BadRequest("\"email\": invalid format".to_string())
                }
            },
        }
    }
}

impl From<ResendVerificationOtpError> for ApiError {
    fn from(value: ResendVerificationOtpError) -> Self {
        match value {
            ResendVerificationOtpError::UserNotFound => ApiError::NotFound,
            ResendVerificationOtpError::UserAlreadyVerified => {
                ApiError::BadRequest("user already verified".to_string())
            }
            ResendVerificationOtpError::CooldownNotElapsed => ApiError::BadRequest(
                "cooldown period has not elapsed yet for requesting a new verification code"
                    .to_string(),
            ),
            ResendVerificationOtpError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
