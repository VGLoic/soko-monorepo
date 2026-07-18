use fake::rand::distr::{Distribution, Uniform};
use sha2::Digest;

#[derive(Debug, Clone, PartialEq, Eq, sqlx::Type)]
pub struct Otp(String);

impl From<String> for Otp {
    fn from(s: String) -> Self {
        Otp(s)
    }
}

impl From<&str> for Otp {
    fn from(s: &str) -> Self {
        Otp(s.to_string())
    }
}

impl Otp {
    /// Generates a random 6-digit OTP
    pub fn generate() -> Result<Self, anyhow::Error> {
        let mut rng = fake::rand::rng();
        let between = Uniform::try_from(0..10)
            .map_err(|e| anyhow::anyhow!("Failed to create uniform distribution: {}", e))?;
        Ok(Otp((0..6)
            .map(|_| between.sample(&mut rng).to_string())
            .collect()))
    }

    /// Hashes the OTP using SHA-256
    pub fn hash(&self) -> [u8; 32] {
        // Use a secure hashing algorithm to hash the OTP
        let mut hasher = sha2::Sha256::new();
        hasher.update(self.0.as_bytes());
        hasher.finalize().into()
    }

    /// Verifies the OTP against a given hash
    /// REMIND ME - REMOVE THIS once used
    #[allow(dead_code)]
    pub fn verify(&self, hash: &[u8; 32]) -> bool {
        self.hash() == *hash
    }

    /// Show the OTP as a &str
    pub fn show(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate() {
        let otp = Otp::generate().unwrap();
        assert_eq!(otp.0.len(), 6);
    }

    #[test]
    fn test_hash() {
        let otp = Otp::from("123456");
        let hash = otp.hash();
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_verify() {
        let otp = Otp::from("123456");
        let hash = otp.hash();
        assert!(otp.verify(&hash));
    }
}
