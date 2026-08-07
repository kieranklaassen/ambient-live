module SessionTestHelper
  def sign_in_as(user)
    Current.session = user.sessions.create!

    ActionDispatch::TestRequest.create.cookie_jar.tap do |cookie_jar|
      cookie_jar.signed[:session_id] = Current.session.id
      cookies["session_id"] = cookie_jar[:session_id]
    end
  end

  def sign_out
    Current.session&.destroy!
    cookies.delete("session_id")
  end

  # Only config/environments/development.rb enables auto-login, so exercising it here
  # means flipping the same config flag the concern reads.
  def with_auto_login
    previous = Rails.configuration.x.auto_login
    Rails.configuration.x.auto_login = true
    yield
  ensure
    Rails.configuration.x.auto_login = previous
  end
end

ActiveSupport.on_load(:action_dispatch_integration_test) do
  include SessionTestHelper
end
