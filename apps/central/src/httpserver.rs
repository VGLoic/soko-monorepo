use axum::Router;
use std::net::SocketAddr;
use tokio::{net::TcpListener, signal};
use tracing::{error, info};

pub async fn serve_http_server(
    tcp_listener: TcpListener,
    router: Router,
) -> Result<(), anyhow::Error> {
    axum::serve(
        tcp_listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .map_err(|err| {
        let err = format!("Error while serving the routes: {err}");
        error!(err);
        anyhow::anyhow!(err)
    })?;

    info!("App has been gracefully shutdown");

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
