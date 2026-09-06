use askama::Template;
use axum::response::{Html, IntoResponse, Response};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TemplateError {
    #[error("Page not found")]
    NotFound,
    #[error("Internal server error")]
    InternalServerError,
    #[error("Failed to render template: {0}")]
    Render(#[from] askama::Error),
}

#[derive(Template)]
#[template(path = "error.html")]
pub struct ErrorTemplate {
    err: TemplateError,
}

pub struct HtmlTemplate<T>(T);

impl<T> HtmlTemplate<T> {
    pub fn new(template: T) -> Self {
        HtmlTemplate(template)
    }
}

impl<T> IntoResponse for HtmlTemplate<T>
where
    T: Template,
{
    fn into_response(self) -> Response {
        match self.0.render() {
            Ok(html) => Html(html).into_response(),
            Err(err) => {
                let error_template = ErrorTemplate {
                    err: TemplateError::Render(err),
                };
                let error_html = error_template.render().unwrap_or_else(|_| {
                    "<h1>Internal Server Error</h1><p>Failed to render error template.</p>"
                        .to_string()
                });
                Html(error_html).into_response()
            }
        }
    }
}

impl IntoResponse for TemplateError {
    fn into_response(self) -> Response {
        let error_template = ErrorTemplate { err: self };
        let error_html = error_template.render().unwrap_or_else(|_| {
            "<h1>Internal Server Error</h1><p>Failed to render error template.</p>".to_string()
        });
        Html(error_html).into_response()
    }
}
