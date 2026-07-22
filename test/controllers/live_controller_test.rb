require "test_helper"

class LiveControllerTest < ActionDispatch::IntegrationTest
  setup { @user = users(:owner) }

  test "index renders the live page with the user's samples newest first" do
    sign_in_as(@user)
    older = create_sample("Older")
    newer = create_sample("Newer")
    newer.update!(created_at: older.created_at + 1.minute)

    get root_path

    assert_response :success
    props = inertia_props
    assert_equal "live/index", props["component"]
    names = props["props"]["samples"].map { |s| s["name"] }
    assert_equal %w[Newer Older], names
    assert props["props"]["samples"].all? { |s| s["url"].present? }
  end

  test "index does not leak other users' samples" do
    other_sample = nil
    sign_in_as(users(:other))
    other_sample = create_sample("Not yours", user: users(:other))

    sign_in_as(@user)
    get root_path

    names = inertia_props["props"]["samples"].map { |s| s["name"] }
    assert_not_includes names, other_sample.name
  end

  test "index requires authentication" do
    get root_path
    assert_redirected_to new_session_path
  end

  private
    def create_sample(name, user: @user)
      sample = user.samples.new(name: name)
      sample.audio_file.attach(
        io: File.open(Rails.root.join("test/fixtures/files/tone.wav")),
        filename: "tone.wav",
        content_type: "audio/wav"
      )
      sample.save!
      sample
    end

    # The initial page JSON lives in a script element (see
    # config.use_script_element_for_initial_page in the inertia initializer).
    def inertia_props
      JSON.parse(Nokogiri::HTML(response.body).at_css("script[type='application/json'][data-page]").text)
    end
end
