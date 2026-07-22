class Sample < ApplicationRecord
  AUDIO_CONTENT_TYPES = %w[
    audio/wav audio/x-wav audio/wave
    audio/mpeg audio/mp4 audio/x-m4a
    audio/flac audio/x-flac
    audio/ogg audio/aiff audio/x-aiff
  ].freeze
  MAX_FILE_SIZE = 50.megabytes

  belongs_to :user
  has_one_attached :audio_file

  before_validation :derive_name_from_filename

  validates :name, presence: true
  validate :audio_file_must_be_attached_audio

  private
    def derive_name_from_filename
      return if name.present?
      self.name = audio_file.filename.base if audio_file.attached?
    end

    def audio_file_must_be_attached_audio
      unless audio_file.attached?
        errors.add(:audio_file, "must be attached")
        return
      end

      unless AUDIO_CONTENT_TYPES.include?(audio_file.content_type)
        errors.add(:audio_file, "must be an audio file (wav, mp3, m4a, flac, ogg, or aiff)")
      end

      if audio_file.byte_size > MAX_FILE_SIZE
        errors.add(:audio_file, "must be smaller than #{MAX_FILE_SIZE / 1.megabyte}MB")
      end
    end
end
