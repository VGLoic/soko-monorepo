use thiserror::Error;

#[derive(Error, Debug)]
pub enum GetUserByEmailError {
    #[error("User not found")]
    NotFound,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
