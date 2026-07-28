use axum::{Router, routing::post};

use crate::{
    router::AppState,
    users::handlers::{
        email_signup::handle_signup_email, resend_verification_otp::handle_resend_verification_otp,
        verify_email::handle_verify_email,
    },
};

pub fn auth_router() -> Router<AppState> {
    Router::new()
        .route("/signup/email", post(handle_signup_email))
        .route("/verify-email", post(handle_verify_email))
        .route(
            "/resend-verification-otp",
            post(handle_resend_verification_otp),
        )
}
