use axum::http::StatusCode;
use ethoko_central::{
    newtypes::{email::Email, handle::Handle, password::Password},
    users::models::{email_signup::SignupEmailBody, verify_email::VerifyEmailBody},
};
mod common;
use common::{default_test_config, setup_instance};
use fake::{Fake, Faker};

#[tokio::test]
async fn test_verify_email() {
    let instance_state = setup_instance(&default_test_config()).await.unwrap();

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

    let otp_email_subject = instance_state
        .email_service
        .get_emails_sent_to(&email)
        .pop()
        .expect("no email sent to user");

    // Format coming directly from users job processor for now
    let otp = otp_email_subject.strip_prefix("OTP: ").unwrap().trim();

    let verify_email_body = VerifyEmailBody {
        email: email.to_string(),
        otp: otp.to_string(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .json(&verify_email_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
