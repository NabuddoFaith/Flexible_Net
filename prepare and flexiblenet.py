import numpy as np
import rasterio
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from tensorflow.keras import models, layers
from tensorflow.keras.callbacks import EarlyStopping
import matplotlib.pyplot as plt

# --- CONFIGURATION ---
# Update these paths to your actual raster files
cdm_path = 'CDM2.tif'  # Canopy Density Model (with height inclusive)
sentinel2_path = 'SENTINEL2.tif'  # Sentinel-2 multi-band raster
output_agb_path = '/content/AGB_predicted_flexnet.tif'
output_weights_path = '/content/agb_flexnet_weights_raster.h5'

# --- STEP 1: LOAD RASTER DATA ---
print("=" * 60)
print("STEP 1: Loading raster data...")
print("=" * 60)

try:
    # Load CDM raster
    with rasterio.open(cdm_path) as cdm_src:
        cdm = cdm_src.read(1)  # Read first (or only) band
        cdm_profile = cdm_src.profile
        cdm_crs = cdm_src.crs
        print(f"✓ CDM loaded: shape={cdm.shape}, CRS={cdm_crs}")

except FileNotFoundError:
    print(f"✗ Error: CDM file not found at {cdm_path}")
    raise

try:
    # Load Sentinel-2 raster(s)
    with rasterio.open(sentinel2_path) as s2_src:
        # Read all bands
        s2_data = s2_src.read()  # Shape: (num_bands, height, width)
        s2_profile = s2_src.profile
        s2_crs = s2_src.crs
        print(f"✓ Sentinel-2 loaded: shape={s2_data.shape}, CRS={s2_crs}")
        print(f"  Number of bands: {s2_data.shape[0]}")

        # Verify CRS and dimensions match
        if cdm.shape != s2_data.shape[1:]:
            print(f"✗ Error: Raster dimensions don't match!")
            print(f"  CDM: {cdm.shape}, S2: {s2_data.shape[1:]}")
            raise ValueError("Raster dimensions mismatch")
        if cdm_crs != s2_crs:
            print(f"⚠ Warning: CRS mismatch (CDM: {cdm_crs}, S2: {s2_crs})")

except FileNotFoundError:
    print(f"✗ Error: Sentinel-2 file not found at {sentinel2_path}")
    raise

# --- STEP 2: PREPARE TRAINING DATA FROM RASTER PIXELS ---
print("\n" + "=" * 60)
print("STEP 2: Preparing training data from raster pixels...")
print("=" * 60)

# Flatten rasters
cdm_flat = cdm.flatten()
s2_flat = s2_data.reshape(s2_data.shape[0], -1)  # Shape: (num_bands, num_pixels)

# Stack CDM and Sentinel-2 as features
# X: each row is [CDM_value, S2_band1, S2_band2, ...]
X_raster = np.vstack([cdm_flat, s2_flat]).T  # Shape: (num_pixels, 1 + num_s2_bands)

# Use CDM as AGB target (you can replace this with actual AGB raster if available)
y_raster = cdm_flat

print(f"Total pixels: {X_raster.shape[0]}")
print(f"Features per pixel: {X_raster.shape[1]} (CDM + {X_raster.shape[1]-1} S2 bands)")
print(f"Target: CDM values (proxy for AGB)")

# Remove no-data / NaN pixels
# Remove no-data / NaN pixels AND massive GIS NoData fill values (3.4e+38)
# We use 1e30 as a threshold to safely catch any standard float32 fill value
valid_mask = (
    ~np.isnan(X_raster).any(axis=1) & 
    ~np.isnan(y_raster) & 
    (y_raster > 0) & 
    (y_raster < 1e30) & 
    (X_raster[:, 0] < 1e30)
)
X_clean = X_raster[valid_mask]
y_clean = y_raster[valid_mask]

print(f"Valid pixels (no NaN, AGB > 0): {X_clean.shape[0]}")
print(f"Removed pixels: {np.sum(~valid_mask)}")

if X_clean.shape[0] < 10:
    print("✗ Error: Not enough valid pixels for training!")
    raise ValueError("Insufficient training data")

# Print data statistics safely
# np.set_printoptions formats how arrays look when printed
np.set_printoptions(precision=2, suppress=True)

print(f"\nFeature statistics (before scaling):")
print(f"   X min: {X_clean.min(axis=0)}")
print(f"   X max: {X_clean.max(axis=0)}")
print(f"   X mean: {X_clean.mean(axis=0)}")
print(f"\nTarget (AGB) statistics:")
print(f"  Min: {y_clean.min():.2f}")
print(f"  Max: {y_clean.max():.2f}")
print(f"  Mean: {y_clean.mean():.2f}")
print(f"  Std: {y_clean.std():.2f}")

# --- STEP 3: SCALE FEATURES AND TARGET ---
print("\n" + "=" * 60)
print("STEP 3: Scaling data...")
print("=" * 60)

X_scaler = StandardScaler()
y_scaler = StandardScaler()

X_scaled = X_scaler.fit_transform(X_clean)
y_reshaped = y_clean.reshape(-1, 1)
y_scaled = y_scaler.fit_transform(y_reshaped).flatten()

print("✓ Data scaled with StandardScaler")
print(f"  X scaled shape: {X_scaled.shape}")
print(f"  y scaled shape: {y_scaled.shape}")

# --- STEP 4: TRAIN/TEST SPLIT ---
print("\n" + "=" * 60)
print("STEP 4: Splitting data into training and testing sets...")
print("=" * 60)

X_train_scaled, X_test_scaled, y_train_scaled, y_test_scaled = train_test_split(
    X_scaled, y_scaled, test_size=0.2, random_state=42
)

print(f"✓ Train set: {X_train_scaled.shape[0]} samples")
print(f"✓ Test set: {X_test_scaled.shape[0]} samples")

# --- STEP 5: BUILD FLEXIBLE NET ---
print("\n" + "=" * 60)
print("STEP 5: Building flexible net model...")
print("=" * 60)

def build_flexible_net(input_shape):
    """
    Flexible neural network for AGB regression.

    Args:
        input_shape: Number of input features (CDM + S2 bands)

    Returns:
        Compiled Keras model
    """
    model = models.Sequential([
        layers.Input(shape=(input_shape,)),
        layers.Dense(128, activation='relu'),
        layers.BatchNormalization(),
        layers.Dense(64, activation='relu'),
        layers.Dropout(0.2),
        layers.Dense(32, activation='relu'),
        layers.BatchNormalization(),
        layers.Dense(16, activation='relu'),
        layers.Dropout(0.1),
        layers.Dense(1, activation='linear')  # Regression output
    ])
    model.compile(optimizer='adam', loss='mse', metrics=['mae'])
    return model

input_features = X_train_scaled.shape[1]
agb_model = build_flexible_net(input_features)
agb_model.summary()
print(f"✓ Model created with {input_features} input features")

# --- STEP 6: TRAIN MODEL ---
print("\n" + "=" * 60)
print("STEP 6: Training model on raster data...")
print("=" * 60)

early_stopping = EarlyStopping(
    monitor='val_loss',
    patience=20,
    restore_best_weights=True,
    verbose=1
)

history = agb_model.fit(
    X_train_scaled, y_train_scaled,
    validation_data=(X_test_scaled, y_test_scaled),
    epochs=200,
    batch_size=32,
    callbacks=[early_stopping],
    verbose=1
)

print("\n✓ Model training complete")

# --- STEP 7: EVALUATE MODEL ---
print("\n" + "=" * 60)
print("STEP 7: Evaluating model performance...")
print("=" * 60)

loss_test, mae_test = agb_model.evaluate(X_test_scaled, y_test_scaled, verbose=0)
print(f"Test Loss (MSE): {loss_test:.4f}")
print(f"Test MAE (scaled): {mae_test:.4f}")

# Inverse transform MAE to original units
dummy_mae = np.array([[mae_test]])
mae_original = y_scaler.inverse_transform(dummy_mae)[0][0]
print(f"Test MAE (original AGB units): {mae_original:.2f}")

# Save model weights
agb_model.save_weights(output_weights_path)
print(f"\n✓ Model weights saved to: {output_weights_path}")

# --- STEP 8: GENERATE FULL-EXTENT AGB PREDICTIONS ---
print("\n" + "=" * 60)
print("STEP 8: Generating AGB predictions for entire CDM...")
print("=" * 60)

# Prepare all pixels (including no-data) for prediction
X_all_scaled = X_scaler.transform(X_raster)
# Prevent infinity/overflow issues in non-valid pixel rows during predict passes
X_all_scaled[~valid_mask] = 0

# Initialize output array with NaN
agb_predictions_full = np.full(X_raster.shape[0], np.nan, dtype=np.float32)

# Predict only for valid pixels
agb_predictions_scaled = agb_model.predict(X_all_scaled[valid_mask], verbose=0)
agb_predictions_original = y_scaler.inverse_transform(agb_predictions_scaled)
agb_predictions_full[valid_mask] = agb_predictions_original.flatten()

# Reshape back to raster format
agb_raster = agb_predictions_full.reshape(cdm.shape)

print(f"✓ Predictions generated")
print(f"  Predicted AGB - Min: {np.nanmin(agb_raster):.2f}")
print(f"  Predicted AGB - Max: {np.nanmax(agb_raster):.2f}")
print(f"  Predicted AGB - Mean: {np.nanmean(agb_raster):.2f}")
print(f"  Predicted AGB - Std: {np.nanstd(agb_raster):.2f}")

# --- STEP 9: SAVE OUTPUT GEOTIFF ---
print("\n" + "=" * 60)
print("STEP 9: Saving output GeoTIFF...")
print("=" * 60)

# Update profile for output
output_profile = cdm_profile.copy()
output_profile.update(dtype=rasterio.float32, count=1, nodata=np.nan)

with rasterio.open(output_agb_path, 'w', **output_profile) as dst:
    dst.write(agb_raster, 1)

print(f"✓ AGB predictions saved to: {output_agb_path}")

# --- STEP 10: VISUALIZATION (OPTIONAL) ---
print("\n" + "=" * 60)
print("STEP 10: Generating visualizations...")
print("=" * 60)

fig, axes = plt.subplots(2, 2, figsize=(14, 12))

# Plot 1: CDM
im1 = axes[0, 0].imshow(cdm, cmap='viridis')
axes[0, 0].set_title('Input: Canopy Density Model (CDM)')
axes[0, 0].set_xlabel('X (pixels)')
axes[0, 0].set_ylabel('Y (pixels)')
plt.colorbar(im1, ax=axes[0, 0], label='CDM Value')

# Plot 2: First Sentinel-2 band
im2 = axes[0, 1].imshow(s2_data[0], cmap='gray')
axes[0, 1].set_title(f'Input: Sentinel-2 Band 1')
axes[0, 1].set_xlabel('X (pixels)')
axes[0, 1].set_ylabel('Y (pixels)')
plt.colorbar(im2, ax=axes[0, 1], label='Reflectance')

# Plot 3: Predicted AGB
im3 = axes[1, 0].imshow(agb_raster, cmap='RdYlGn', vmin=np.nanpercentile(agb_raster, 5),
                         vmax=np.nanpercentile(agb_raster, 95))
axes[1, 0].set_title('Output: Predicted AGB (Flexible Net)')
axes[1, 0].set_xlabel('X (pixels)')
axes[1, 0].set_ylabel('Y (pixels)')
plt.colorbar(im3, ax=axes[1, 0], label='AGB (kg/ha)')

# Plot 4: Training history
axes[1, 1].plot(history.history['loss'], label='Training Loss')
axes[1, 1].plot(history.history['val_loss'], label='Validation Loss')
axes[1, 1].set_xlabel('Epoch')
axes[1, 1].set_ylabel('Loss (MSE)')
axes[1, 1].set_title('Model Training History')
axes[1, 1].legend()
axes[1, 1].grid(True, alpha=0.3)

plt.tight_layout()
output_viz_path = '/content/drive/MyDrive/research/AGB_training_visualization.png'
plt.savefig(output_viz_path, dpi=100, bbox_inches='tight')
print(f"✓ Visualization saved to: {output_viz_path}")
plt.show()

# --- SUMMARY ---
print("\n" + "=" * 60)
print("WORKFLOW COMPLETE")
print("=" * 60)
print(f"✓ CDM input: {cdm_path}")
print(f"✓ Sentinel-2 input: {sentinel2_path}")
print(f"✓ Training samples: {X_train_scaled.shape[0]}")
print(f"✓ Test samples: {X_test_scaled.shape[0]}")
print(f"✓ Model weights: {output_weights_path}")
print(f"✓ AGB raster output: {output_agb_path}")
print(f"✓ Final test MAE: {mae_original:.2f} (original units)")
print("=" * 60)