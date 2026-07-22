require "test_helper"

class SampleTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup { @user = users(:owner) }

  def build_sample(name: nil, filename: "tone.wav", content_type: "audio/wav")
    sample = @user.samples.new(name: name)
    sample.audio_file.attach(
      io: File.open(Rails.root.join("test/fixtures/files", filename)),
      filename: filename,
      content_type: content_type
    )
    sample
  end

  test "valid with an attached wav file" do
    assert_predicate build_sample(name: "Pad"), :valid?
  end

  test "invalid without an attachment" do
    sample = @user.samples.new(name: "Empty")
    assert_not sample.valid?
    assert_includes sample.errors[:audio_file], "must be attached"
  end

  test "invalid with a non-audio content type" do
    sample = build_sample(name: "Nope", filename: "not_audio.txt", content_type: "text/plain")
    assert_not sample.valid?
    assert sample.errors[:audio_file].any? { |e| e.include?("must be an audio file") }
  end

  test "invalid when larger than the size cap" do
    sample = build_sample(name: "Huge")
    blob = sample.audio_file.blob
    def blob.byte_size = 51.megabytes

    assert_not sample.valid?
    assert sample.errors[:audio_file].any? { |e| e.include?("smaller than 50MB") }
  end

  test "derives blank name from the filename" do
    sample = build_sample
    assert_predicate sample, :valid?
    assert_equal "tone", sample.name
  end

  test "destroy purges the attached blob" do
    sample = build_sample(name: "Purge me")
    sample.save!
    blob = sample.audio_file.blob

    perform_enqueued_jobs { sample.destroy! }

    assert_not ActiveStorage::Blob.exists?(blob.id)
  end
end
