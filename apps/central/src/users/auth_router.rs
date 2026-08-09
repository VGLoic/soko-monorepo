use crate::router::IpRateLimiter;
use crate::{
    config::RateLimitConfig,
    router::AppState,
    users::handlers::{
        email_signup::handle_signup_email, resend_verification_otp::handle_resend_verification_otp,
        verify_email::handle_verify_email,
    },
};
use axum::{Router, routing::post};
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;

pub fn auth_router(
    rate_limit_config: RateLimitConfig,
) -> Result<(Router<AppState>, IpRateLimiter), anyhow::Error> {
    let auth_router_governor_conf = GovernorConfigBuilder::default()
        .per_second(rate_limit_config.replenishment_per_second)
        .burst_size(rate_limit_config.max_burst_size)
        .finish()
        .ok_or_else(|| {
            anyhow::anyhow!("Error while building the auth router governor configuration")
        })?;

    let limiter = auth_router_governor_conf.limiter().clone();

    let router = Router::new()
        .route("/signup/email", post(handle_signup_email))
        .route("/verify-email", post(handle_verify_email))
        .route(
            "/resend-verification-otp",
            post(handle_resend_verification_otp)
                .layer(GovernorLayer::new(auth_router_governor_conf)),
        );

    Ok((router, IpRateLimiter::new(limiter)))
}
