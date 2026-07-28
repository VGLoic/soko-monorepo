use std::time::Duration;

use axum::http::StatusCode;
use ethoko_central::{
    newtypes::{email::Email, handle::Handle, password::Password},
    users::models::{
        email_signup::SignupEmailBody,
        verify_email::VerifyEmailBody,
    },
};
mod common;
use common::{TestConfigBuilder, setup_instance};
use fake::{Fake, Faker};

async fn setup_user(instance_state: &common::InstanceState) -> (Email, Handle, Password) {
    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = Faker.fake::<Password>();

    let signup_body = SignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    let _ = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&signup_body)
        .send()
        .await
        .unwrap();

    instance_state.job_worker.consume_jobs().await.unwrap();

    (email, handle, password)
}

#[tokio::test]
async fn test_resend_verification_email_200() {
    let instance_state = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(3).build())
        .await
        .unwrap();

    let (email, _handle, _password) = setup_user(&instance_state).await;

    // Process the first OTP email sending
    instance_state.job_worker.consume_jobs().await.unwrap();

    // Wait for 4 seconds to ensure the cooldown period has passed
    tokio::time::sleep(Duration::from_secs(4)).await;

    let resend_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": email.to_string() }))
        .send()
        .await
        .unwrap();

    // Process the second OTP email sending
    instance_state.job_worker.consume_jobs().await.unwrap();

    let emails_sent = instance_state.email_service.get_emails_sent_to(&email);
    let second_otp = emails_sent
        .get(1)
        .expect("Expected a second OTP email to be sent")
        .strip_prefix("OTP: ")
        .map(|s| s.trim().to_string())
        .unwrap();

    let verify_email_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .json(&VerifyEmailBody {
            email: email.to_string(),
            otp: second_otp,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::OK);
    assert_eq!(emails_sent.len(), 2);
    assert_eq!(verify_email_response.status(), StatusCode::OK);
}
