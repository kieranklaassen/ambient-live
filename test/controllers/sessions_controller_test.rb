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
end
