class User < ApplicationRecord
  OWNER_EMAIL = ENV.fetch("OWNER_EMAIL", "kieran@example.com")
  OWNER_PASSWORD = ENV.fetch("OWNER_PASSWORD", "ambient-live")

  has_secure_password
  has_many :sessions, dependent: :destroy
  has_many :samples, dependent: :destroy

  normalizes :email_address, with: ->(e) { e.strip.downcase }

  # The single account this app belongs to. Seeding and dev auto-login share it so a
  # fresh checkout works without a manual `db:seed`.
  def self.owner
    find_or_create_by!(email_address: OWNER_EMAIL) { |user| user.password = OWNER_PASSWORD }
  rescue ActiveRecord::RecordNotUnique
    find_by!(email_address: OWNER_EMAIL)
  end
end
