use axum::http::StatusCode;
use ethoko_central::router::GetHealthcheckResponse;
mod common;
use common::{TestConfigBuilder, setup_instance};

#[tokio::test]
async fn test_healthcheck() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = reqwest::get(format!("{}/health", &instance_state.server_url))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.json::<GetHealthcheckResponse>().await.unwrap().ok);
}
