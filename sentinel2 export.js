// -----------------------------
// 1. Study Area
// -----------------------------
var studyarea = ee.FeatureCollection("projects/ee-faithnabuddo/assets/studyarea");

Map.centerObject(studyarea, 10);

// 1. Filter the collection
var s2 = ee.ImageCollection("COPERNICUS/S2") // L1C is better for 2017
            .filterBounds(studyarea)
            .filterDate('2017-01-01','2017-12-31')
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
            // FIX: Select only the spectral bands common to ALL images
            .select(['B2', 'B3', 'B4', 'B8']); 

print('Number of images found:', s2.size());

// 2. Create the composite 
// (Median is much cleaner than the If/Mosaic logic for large timeframes)
var s2_image = s2.median().clip(studyarea);

// 3. Add to Map
Map.addLayer(s2_image, 
  {bands: ['B4', 'B3', 'B2'], min: 0, max: 3000}, 
  'Sentinel-2 2017 (Fixed)'
);

// 4. Export using the bounding box geometry
Export.image.toDrive({
  image: s2_image,
  description: 'Sentinel2_2017_Fixed_10m',
  scale: 10,
  region: studyarea.geometry().bounds(), 
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});
