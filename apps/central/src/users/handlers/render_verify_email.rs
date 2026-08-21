use askama::Template;
use axum::extract::{Query, State};
use serde::Deserialize;
use tracing::error;

use super::html_templates::{HtmlTemplate, TemplateError};
use crate::{
    newtypes::email::Email, newtypes::handle::Handle, router::AppState,
    users::models::queries::GetUserByEmailError,
};

#[derive(Template)]
#[template(path = "verify_email.html")]
pub struct VerifyEmailTemplate {
    handle: Handle,
    email: Email,
}

#[derive(Deserialize)]
pub struct VerifyEmailQuery {
    pub email: String,
}
pub async fn handle_render_verify_email(
    State(state): State<AppState>,
    query_params: Query<VerifyEmailQuery>,
) -> Result<HtmlTemplate<VerifyEmailTemplate>, TemplateError> {
    let email = Email::new(query_params.email.as_str()).map_err(|e| {
        error!("Invalid email format: {}", e);
        TemplateError::InternalServerError
    })?;
    let user = state
        .auth_service
        .get_user_by_email(&email)
        .await
        .map_err(|e| match e {
            GetUserByEmailError::NotFound => TemplateError::NotFound,
            GetUserByEmailError::Unknown(err) => {
                error!("Error fetching user by email: {:?}", err);
                TemplateError::InternalServerError
            }
        })?;
    let template = VerifyEmailTemplate {
        handle: user.handle,
        email,
    };
    Ok(HtmlTemplate::new(template))
}
