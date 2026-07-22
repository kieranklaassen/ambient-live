# Single-owner app: seed the owner account. Override via env for non-dev setups.
owner_email = ENV.fetch("OWNER_EMAIL", "kieran@example.com")
owner_password = ENV.fetch("OWNER_PASSWORD", "ambient-live")

User.find_or_create_by!(email_address: owner_email) do |user|
  user.password = owner_password
end
