require "test_helper"

class SamplesControllerTest < ActionDispatch::IntegrationTest
  setup { @user = users(:owner) }

  def wav_upload
    fixture_file_upload("tone.wav", "audio/wav")
  end

  test "create attaches an uploaded audio file to the signed-in user" do
    sign_in_as(@user)

    assert_difference -> { @user.samples.count } => 1 do
      post samples_path, params: { name: "Warm pad", audio_file: wav_upload }
    end

    assert_redirected_to root_path
    sample = @user.samples.last
    assert_equal "Warm pad", sample.name
    assert_predicate sample.audio_file, :attached?
  end

  test "create rejects a non-audio upload" do
    sign_in_as(@user)

    assert_no_difference -> { Sample.count } do
      post samples_path, params: { audio_file: fixture_file_upload("not_audio.txt", "text/plain") }
    end

    assert_redirected_to root_path
  end

  test "create requires authentication" do
    assert_no_difference -> { Sample.count } do
      post samples_path, params: { audio_file: wav_upload }
    end

    assert_redirected_to new_session_path
  end

  test "destroy removes the user's own sample" do
    sign_in_as(@user)
    post samples_path, params: { name: "Doomed", audio_file: wav_upload }
    sample = @user.samples.last

    assert_difference -> { Sample.count } => -1 do
      delete sample_path(sample)
    end

    assert_redirected_to root_path
  end

  test "destroy cannot touch another user's sample" do
    sign_in_as(@user)
    post samples_path, params: { name: "Mine", audio_file: wav_upload }
    sample = @user.samples.last

    sign_in_as(users(:other))
    assert_no_difference -> { Sample.count } do
      delete sample_path(sample)
    end
    assert_response :not_found
  end

  test "destroy requires authentication" do
    delete sample_path(1)
    assert_redirected_to new_session_path
  end
end
