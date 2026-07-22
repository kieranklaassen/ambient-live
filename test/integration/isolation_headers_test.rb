require "test_helper"

class IsolationHeadersTest < ActionDispatch::IntegrationTest
  test "authenticated page responses carry cross-origin isolation headers" do
    sign_in_as(users(:owner))

    get root_path

    assert_equal "same-origin", response.headers["Cross-Origin-Opener-Policy"]
    assert_equal "credentialless", response.headers["Cross-Origin-Embedder-Policy"]
  end

  test "login page response carries cross-origin isolation headers" do
    get new_session_path

    assert_equal "same-origin", response.headers["Cross-Origin-Opener-Policy"]
    assert_equal "credentialless", response.headers["Cross-Origin-Embedder-Policy"]
  end
end
