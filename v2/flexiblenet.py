import rasterio
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models
import os

# --- 1. DEFINE THE FLEXIBLE NET ARCHITECTURE ---
def build_flexible_net(input_shape=(4,)):
    """
    Architecture must match the one used during the Training Phase.
    Bands: [NDVI, CHM, CDM, Roughness]
    """
    model = models.Sequential([
        layers.Input(shape=input_shape),
        layers.Dense(128, activation='relu'),
        layers.BatchNormalization(), 
        layers.Dense(64, activation='relu'),
        layers.Dropout(0.2), 
        layers.Dense(32, activation='relu'),
        layers.Dense(1, activation='linear')
    ])
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='mse',
        metrics=['mae']
    )
    return model

# --- 2. PREPARE INFERENCE FUNCTION (Batch Processing) ---
def run_large_inference(file_path, model, output_name='Rwenzori_AGB_Map.tif'):
    """
    Processes the large GeoTIFF in windows to prevent Colab RAM crashes.
    """
    with rasterio.open(file_path) as src:
        profile = src.profile
        num_bands, height, width = src.count, src.height, src.width
        
        # Update metadata for single-band output (AGB in Mg/ha)
        profile.update(dtype=rasterio.float32, count=1, nodata=0)
        
        # Initialize output array
        agb_output = np.zeros((height, width), dtype=np.float32)

        # Process by "Row Blocks"
        row_step = 500 
        print(f"Starting inference for {height}x{width} pixels...")

        for r in range(0, height, row_step):
            r_end = min(r + row_step, height)
            
            # 1. Read Window
            window = rasterio.windows.Window(0, r, width, r_end - r)
            window_data = src.read(window=window) 
            
            # 2. Reshape for Neural Net (Pixels, 4)
            rows_in_window = window_data.shape[1]
            pixels = window_data.transpose(1, 2, 0).reshape(-1, num_bands)
            
            # 3. Clean Data (Handle NaNs from GEE masks)
            pixels = np.nan_to_num(pixels, nan=0.0)
            
            # 4. PREDICTION (Uses GPU if enabled in Colab)
            pred_window = model.predict(pixels, batch_size=10000, verbose=0)
            
            # 5. Place back into spatial grid
            agb_output[r:r_end, :] = pred_window.reshape(rows_in_window, width)
            
            if r % 1000 == 0:
                print(f"Progress: {round((r_end/height)*100, 1)}%")

    # SAVE TO DRIVE/COLAB
    with rasterio.open(output_name, 'w', **profile) as dst:
        dst.write(agb_output, 1)
    
    print(f"\nSuccess! Final AGB map saved as: {output_name}")
    return output_name

# --- 3. EXECUTION ---
# Path to your GEE Stack
file_path = 'AGB_Input_Stack_Rwenzori_Final.tif'
# Path to the weights saved in the Training Phase cell
weights_path = 'rwenzori_agb_weights.h5'

# Initialize model
agb_model = build_flexible_net()

if os.path.exists(weights_path):
    print("Loading trained weights...")
    agb_model.load_weights(weights_path)
    
    if os.path.exists(file_path):
        run_large_inference(file_path, agb_model)
    else:
        print(f"Error: {file_path} not found. Upload the GeoTIFF first.")
else:
    print("Error: Trained weights not found. Run the Training cell first!")