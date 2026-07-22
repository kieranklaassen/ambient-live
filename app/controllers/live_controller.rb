# frozen_string_literal: true

class LiveController < InertiaController
  def index
    render inertia: "live/index", props: {
      samples: Current.user.samples.with_attached_audio_file.order(created_at: :desc).map do |sample|
        {
          id: sample.id,
          name: sample.name,
          url: url_for(sample.audio_file)
        }
      end
    }
  end
end
