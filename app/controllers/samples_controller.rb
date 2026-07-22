class SamplesController < ApplicationController
  def create
    sample = Current.user.samples.new(sample_params)

    if sample.save
      redirect_to root_path
    else
      redirect_to root_path, inertia: { errors: sample.errors.to_hash(true) }
    end
  end

  def destroy
    Current.user.samples.find(params[:id]).destroy!
    redirect_to root_path
  end

  private
    def sample_params
      params.permit(:name, :audio_file)
    end
end
