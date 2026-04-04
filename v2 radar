# ======================================================
# PART 1: GOOGLE EARTH ENGINE (JAVASCRIPT CODE)
# ======================================================
# Copy this part into Google Earth Engine Code Editor

"""
var studyArea = ee.FeatureCollection("users/yourusername/your_shapefile");

Map.centerObject(studyArea, 10);

// Sentinel-1
var s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
  .filterBounds(studyArea)
  .filterDate('2021-01-01', '2022-12-31')
  .select(['VV', 'VH'])
  .median()
  .clip(studyArea);

var s1db = s1.log10().multiply(10);

// Radar indices
var ratio = s1db.select('VH').divide(s1db.select('VV')).rename('VH_VV');

var ndri = s1db.expression(
  '(VH - VV) / (VH + VV)', {
    'VH': s1db.select('VH'),
    'VV': s1db.select('VV')
}).rename('NDRI');

var features = s1db.addBands([ratio, ndri]);

// GEDI Biomass
var gedi = ee.ImageCollection("LARSE/GEDI/GEDI04_A_002_MONTHLY")
  .filterBounds(studyArea)
  .filterDate('2021-01-01', '2022-12-31');

var agb = gedi.select('agbd').median().clip(studyArea);

// Combine
var trainingImage = features.addBands(agb);

// Sample training data
var samples = trainingImage.sample({
  region: studyArea,
  scale: 30,
  numPixels: 5000,
  geometries: true
});

Export.table.toDrive({
  collection: samples,
  description: 'training_data',
  fileFormat: 'CSV'
});
"""

# ======================================================
# PART 2: PYTHON FLEXIBLENET MODEL
# ======================================================

import torch
import torch.nn as nn
import torch.optim as optim
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# Load dataset

data = pd.read_csv("training_data.csv")

# Features and label
X = data[['VV','VH','VH_VV','NDRI']].values
y = data['agbd'].values

# Normalize
scaler = StandardScaler()
X = scaler.fit_transform(X)

# Train-test split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

# Convert to tensors
X_train = torch.tensor(X_train, dtype=torch.float32)
y_train = torch.tensor(y_train, dtype=torch.float32).view(-1,1)

X_test = torch.tensor(X_test, dtype=torch.float32)
y_test = torch.tensor(y_test, dtype=torch.float32).view(-1,1)

# ======================================================
# FLEXIBLENET MODEL
# ======================================================

class FlexibleNet(nn.Module):
    def __init__(self, input_size):
        super(FlexibleNet, self).__init__()
        
        self.model = nn.Sequential(
            nn.Linear(input_size, 64),
            nn.ReLU(),
            nn.BatchNorm1d(64),
            
            nn.Linear(64, 128),
            nn.ReLU(),
            nn.Dropout(0.3),
            
            nn.Linear(128, 64),
            nn.ReLU(),
            
            nn.Linear(64, 1)
        )
    
    def forward(self, x):
        return self.model(x)

# Initialize
model = FlexibleNet(X_train.shape[1])
criterion = nn.MSELoss()
optimizer = optim.Adam(model.parameters(), lr=0.001)

# ======================================================
# TRAINING
# ======================================================

epochs = 50

for epoch in range(epochs):
    model.train()
    outputs = model(X_train)
    loss = criterion(outputs, y_train)
    
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
    
    if epoch % 10 == 0:
        print(f"Epoch {epoch}, Loss: {loss.item()}")

# ======================================================
# EVALUATION
# ======================================================

model.eval()
predictions = model(X_test)

rmse = torch.sqrt(nn.MSELoss()(predictions, y_test))
print("RMSE:", rmse.item())

# ======================================================
# CARBON CALCULATION
# ======================================================

carbon = predictions * 0.47
print("Sample Carbon Estimates:", carbon[:5])

# ======================================================
# FINAL OUTPUT
# ======================================================
# You now have:
# - Biomass predictions
# - Carbon estimates
# - A trained FlexibleNet model
