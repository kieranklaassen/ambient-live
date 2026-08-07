require "test_helper"

class SessionsControllerTest < ActionDispatch::IntegrationTest
  setup { @user = users(:owner) }

  test "new renders the login page" do
    get new_session_path
    assert_response :success
  end

  test "create with valid credentials signs in and redirects to root" do
    post session_path, params: { email_address: @user.email_address, password: "password" }

    assert_redirected_to root_url
    assert cookies[:session_id].present?

    follow_redirect!
    assert_response :success
  end

  test "create with invalid credentials re-renders login with an error and no session" do
    post session_path, params: { email_address: @user.email_address, password: "wrong" }

    assert_redirected_to new_session_path
    assert_not cookies[:session_id].present?
  end

  test "unauthenticated request to root redirects to login" do
    get root_path
    assert_redirected_to new_session_path
  end

  test "destroy terminates the session and gates subsequent requests" do
    sign_in_as(@user)

    delete session_path
    assert_redirected_to new_session_path

    get root_path
    assert_redirected_to new_session_path
  end

  test "auto-login is disabled unless the environment opts in" do
    assert_not Rails.configuration.x.auto_login.present?
  end

  test "auto-login signs an unauthenticated request in as the owner" do
    with_auto_login do
      assert_difference -> { User.count }, +1 do
        get root_path
      end

      assert_response :success
      assert cookies[:session_id].present?
      assert_equal User::OWNER_EMAIL, Session.sole.user.email_address
    end
  end

  test "auto-login reuses the existing owner account" do
    User.owner

    with_auto_login do
      assert_no_difference -> { User.count } do
        get root_path
      end

      assert_response :success
    end
  end

  test "auto-login replaces a stale session cookie instead of failing" do
    sign_in_as(@user)
    Current.session.destroy!

    with_auto_login do
      get root_path
      assert_response :success
    end
  end

  test "auto-login redirects the login page to root rather than trapping the user" do
    with_auto_login do
      get new_session_path
      assert_redirected_to root_url

      follow_redirect!
      assert_response :success
    end
  end

  test "auto-login re-signs in after destroy without looping" do
    with_auto_login do
      delete session_path
      assert_redirected_to new_session_path

      follow_redirect!
      assert_redirected_to root_url

      follow_redirect!
      assert_response :success
    end
  end
end
