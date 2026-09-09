use axum::{Json, extract::State, http::StatusCode};

use crate::{
    auth::models::{
        requests::verify_email::{
            VerifyEmailBody, VerifyEmailError, VerifyEmailRequest, VerifyEmailRequestError,
        },
        users_response::UserResponse,
    },
    newtypes::email::EmailError,
    router::{ApiError, AppState},
};

pub async fn handle_verify_email(
    State(state): State<AppState>,
    Json(body): Json<VerifyEmailBody>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    let request = VerifyEmailRequest::new(body.otp, body.email)?;

    let user = state.auth_service.verify_email(request).await?;

    Ok((StatusCode::OK, Json(user.into())))
}

impl From<VerifyEmailRequestError> for ApiError {
    fn from(value: VerifyEmailRequestError) -> Self {
        match value {
            VerifyEmailRequestError::InvalidEmail(e) => ApiError::BadRequest(match e {
                EmailError::Empty => "\"email\": empty value not allowed".to_string(),
                EmailError::InvalidFormat => "\"email\": invalid format".to_string(),
            }),
        }
    }
}

impl From<VerifyEmailError> for ApiError {
    fn from(value: VerifyEmailError) -> Self {
        match value {
            VerifyEmailError::EmailAlreadyVerified => {
                ApiError::BadRequest("\"email\": email already verified".to_string())
            }
            VerifyEmailError::InvalidOtp => {
                ApiError::BadRequest("\"otp\": invalid otp".to_string())
            }
            VerifyEmailError::OtpExpired => {
                ApiError::BadRequest("\"otp\": invalid otp".to_string())
            }
            VerifyEmailError::NotFound => ApiError::NotFound,
            VerifyEmailError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
