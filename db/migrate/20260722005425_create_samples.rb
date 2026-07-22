class CreateSamples < ActiveRecord::Migration[8.1]
  def change
    create_table :samples do |t|
      t.references :user, null: false, foreign_key: true
      t.string :name, null: false

      t.timestamps
    end
  end
end
