use crate::auth::handlers::html_templates::HtmlTemplate;
use askama::Template;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
};
use serde::Deserialize;
use tracing::error;

use super::html_templates::TemplateError;
use crate::{
    auth::models::requests::verify_email::{VerifyEmailError, VerifyEmailRequest},
    newtypes::{email::Email, handle::Handle},
    router::AppState,
};

#[derive(Template)]
#[template(path = "verify_email_success.html")]
pub struct VerifyEmailSuccessTemplate {
    handle: Handle,
}

pub enum VerifyEmailActionError {
    EmailAlreadyVerified,
    OtpExpired,
    InvalidOtp,
}
#[derive(Template)]
#[template(path = "verify_email_error.html")]
pub struct VerifyEmailErrorTemplate {
    email: Email,
    err: VerifyEmailActionError,
}

pub enum VerifyEmailActionResponse {
    Success(VerifyEmailSuccessTemplate),
    Error(VerifyEmailErrorTemplate),
}

impl IntoResponse for VerifyEmailActionResponse {
    fn into_response(self) -> axum::response::Response {
        match self {
            VerifyEmailActionResponse::Success(template) => {
                HtmlTemplate::new(template).into_response()
            }
            VerifyEmailActionResponse::Error(template) => {
                HtmlTemplate::new(template).into_response()
            }
        }
    }
}

#[derive(Deserialize)]
pub struct VerifyEmailQueryParams {
    pub email: String,
    pub otp: String,
}
pub async fn handle_verify_email_action(
    State(state): State<AppState>,
    Query(params): Query<VerifyEmailQueryParams>,
) -> Result<VerifyEmailActionResponse, TemplateError> {
    let request = VerifyEmailRequest::new(params.otp, params.email).map_err(|e| {
        error!("Invalid verify email request: {}", e);
        TemplateError::InternalServerError
    })?;

    let email = request.email.clone();
    let user = match state.auth_service.verify_email(request).await {
        Ok(user) => user,
        Err(e) => match e {
            VerifyEmailError::NotFound => {
                return Err(TemplateError::NotFound);
            }
            VerifyEmailError::EmailAlreadyVerified => {
                return Ok(VerifyEmailActionResponse::Error(VerifyEmailErrorTemplate {
                    email: email.clone(),
                    err: VerifyEmailActionError::EmailAlreadyVerified,
                }));
            }
            VerifyEmailError::InvalidOtp => {
                return Ok(VerifyEmailActionResponse::Error(VerifyEmailErrorTemplate {
                    email: email.clone(),
                    err: VerifyEmailActionError::InvalidOtp,
                }));
            }
            VerifyEmailError::OtpExpired => {
                return Ok(VerifyEmailActionResponse::Error(VerifyEmailErrorTemplate {
                    email: email.clone(),
                    err: VerifyEmailActionError::OtpExpired,
                }));
            }
            VerifyEmailError::Unknown(err) => {
                error!("Failed to verify email: {}", err);
                return Err(TemplateError::InternalServerError);
            }
        },
    };

    let template = VerifyEmailSuccessTemplate {
        handle: user.handle,
    };
    Ok(VerifyEmailActionResponse::Success(template))
}
