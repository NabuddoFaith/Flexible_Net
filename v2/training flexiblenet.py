import pandas as pd
import numpy as np
import rasterio
import tensorflow as tf
from tensorflow.keras import layers, models
from sklearn.model_selection import train_test_split
import matplotlib.pyplot as plt

# --- STEP 1: LOAD DATA & CALCULATE FIELD AGB (Allometrics) ---
# Load your field survey (individual tree measurements)
field_df = pd.read_csv('rwenzori_field_data.csv') 

def calculate_tree_agb(dbh, height, density=0.6):
    """ Chave et al. (2014) Allometric Equation """
    return 0.0673 * (density * (dbh**2) * height)**0.976

# Calculate AGB for every tree in kg
field_df['tree_agb_kg'] = field_df.apply(lambda x: calculate_tree_agb(x['dbh_cm'], x['height_m']), axis=1)

# Sum to Plot Level and convert to Mg/ha (assuming 0.1 ha plots, so multiply by 10)
plot_data = field_df.groupby('plot_id').agg({
    'tree_agb_kg': 'sum',
    'lat': 'first',
    'lon': 'first'
}).reset_index()
plot_data['target_agb'] = (plot_data['tree_agb_kg'] / 1000) * 10 

# --- STEP 2: PIXEL EXTRACTION FROM GEOTIFF ---
tif_path = 'AGB_Input_Stack_Rwenzori_Final.tif'
X_features = []

with rasterio.open(tif_path) as src:
    for _, row in plot_data.iterrows():
        # Convert GPS to Pixel Coordinates
        py, px = src.index(row['lon'], row['lat'])
        # Read the 4 bands [NDVI, CHM, CDM, VV] at that specific pixel
        window = rasterio.windows.Window(px, py, 1, 1)
        pixel_values = src.read(window=window).flatten()
        X_features.append(pixel_values)

X = np.nan_to_num(np.array(X_features), nan=0.0)
y = plot_data['target_agb'].values

# --- STEP 3: BUILD & TRAIN FLEXIBLE NET ---
def build_flexible_net(input_shape=(4,)):
    model = models.Sequential([
        layers.Input(shape=input_shape),
        layers.Dense(128, activation='relu'),
        layers.BatchNormalization(),
        layers.Dense(64, activation='relu'),
        layers.Dropout(0.2),
        layers.Dense(32, activation='relu'),
        layers.Dense(1, activation='linear')
    ])
    model.compile(optimizer='adam', loss='mse', metrics=['mae'])
    return model

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train
agb_model = build_flexible_net()
print("Training started...")
history = agb_model.fit(X_train, y_train, validation_data=(X_test, y_test), 
                        epochs=150, batch_size=4, verbose=1)

# --- STEP 4: SAVE WEIGHTS & VALIDATE ---
agb_model.save_weights('rwenzori_agb_weights.h5')
print("\nSuccess: Weights saved to 'rwenzori_agb_weights.h5'")

# Visual Validation Plot
y_pred = agb_model.predict(X_test)
plt.figure(figsize=(6,6))
plt.scatter(y_test, y_pred, color='darkgreen')
plt.plot([y.min(), y.max()], [y.min(), y.max()], 'r--')
plt.xlabel('Field AGB (Mg/ha)')
plt.ylabel('Predicted AGB (Mg/ha)')
plt.title('Flexible Net: Training Validation')
plt.show()