var studyarea = ee.FeatureCollection("projects/ee-faithnabuddo/assets/studyarea");

// 1. The "Sanitizer" Function with Explicit Casting
var prepareImage = function(image) {
  var bands = image.bandNames();
  
  // Create a cloud mask based on available bands
  var qa60Mask = ee.Algorithms.If(bands.contains('QA60'),
    image.select('QA60').bitwiseAnd(1 << 10).eq(0).and(image.select('QA60').bitwiseAnd(1 << 11).eq(0)),
    ee.Image(1)
  );
  var mskMask = ee.Algorithms.If(bands.contains('MSK_CLASSI_OPAQUE'),
    image.select('MSK_CLASSI_OPAQUE').eq(0).and(image.select('MSK_CLASSI_CIRRUS').eq(0)),
    ee.Image(1)
  );
  var mask = ee.Image(qa60Mask).and(ee.Image(mskMask));

  // FIX: Cast the cloud score to Float explicitly to satisfy the 'homogeneous' requirement
  var cloudScore = ee.Image.constant(ee.Number(image.get('CLOUDY_PIXEL_PERCENTAGE')))
    .multiply(-1)
    .rename('cloud_score')
    .toFloat(); // This is the magic line that fixes the Mismatched Type error

  // Select only the necessary bands and cast them all to Float
  return image.addBands(cloudScore)
    .select(['B2', 'B3', 'B4', 'B8', 'cloud_score']) 
    .updateMask(mask)
    .divide(10000)
    .toFloat() // Ensure all spectral bands are also float
    .copyProperties(image, ["system:time_start"]);
};

// 2. Load and Filter
var s2_2017 = ee.ImageCollection("COPERNICUS/S2")
    .filterBounds(studyarea)
    .filterDate('2017-01-01', '2019-12-31')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
    .map(prepareImage);

// 3. Quality Mosaic
var best_pixel_mosaic = s2_2017.qualityMosaic('cloud_score').clip(studyarea);

// 4. Map Display
Map.centerObject(studyarea, 11);
Map.addLayer(best_pixel_mosaic, {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3}, '2017 Success Mosaic');

// 5. Export
Export.image.toDrive({
  image: best_pixel_mosaic.select(['B2', 'B3', 'B4', 'B8']),
  description: 'Sentinel2_2017_Final_Export',
  scale: 10,
  region: studyarea.geometry().bounds(),
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});

// -----------------------------
// 3. Canopy Height Model (CHM)
// -----------------------------
var chm = ee.Image("NASA/JPL/global_forest_canopy_height_2005")
            .clip(studyarea);

var chm_resampled = chm.resample('bilinear');

Map.addLayer(chm_resampled,
  {min:0, max:50, palette:['white','yellow','green','darkgreen']},
  'CHM'
);

Export.image.toDrive({
  image: chm_resampled,
  description: 'CHM_10m',
  scale: 10,
  region: studyarea,
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});

// -------------------------------------------------------------
// 6. Calculate AVI, BI, and SI
// -------------------------------------------------------------

var nir = best_pixel_mosaic.select('B8');
var red = best_pixel_mosaic.select('B4');
var green = best_pixel_mosaic.select('B3');
var blue = best_pixel_mosaic.select('B2');

// Advanced Vegetation Index (AVI)
// Formula: [NIR * (1 - Red) * (NIR - Red)]^(1/3)
var avi = best_pixel_mosaic.expression(
  'sqrt(sqrt(nir * (1 - red) * (nir - red)))', { // Using cube root approximation or root logic
    'nir': nir,
    'red': red
  }).rename('AVI');

// Bare Soil Index (BI)
// Formula: ((Red + SWIR) - (NIR + Blue)) / ((Red + SWIR) + (NIR + Blue))
// Note: Since we only selected 4 bands earlier, if you need SWIR (B11), 
// ensure it's in your .select() list in the prepareImage function.
// Using Blue/Red/NIR/Green variant:
var bi = best_pixel_mosaic.expression(
  '((red + blue) - green) / ((red + blue) + green)', {
    'red': red,
    'blue': blue,
    'green': green
  }).rename('BI');

// Shadow Index (SI)
// Formula: sqrt((1 - Blue) * (1 - Green) * (1 - Red))
var si = best_pixel_mosaic.expression(
  'sqrt((1 - blue) * (1 - green) * (1 - red))', {
    'blue': blue,
    'green': green,
    'red': red
  }).rename('SI');

// -------------------------------------------------------------
// 7. Add Indices to Map
// -------------------------------------------------------------

Map.addLayer(avi, {min: 0, max: 0.5, palette: ['white', 'green']}, 'AVI (Vegetation)');
Map.addLayer(bi, {min: -1, max: 1, palette: ['blue', 'white', 'brown']}, 'BI (Bare Soil)');
Map.addLayer(si, {min: 0.5, max: 1, palette: ['white', 'black']}, 'SI (Shadow)');

// -------------------------------------------------------------
// 8. Export Indices (Stacked)
// -------------------------------------------------------------

var indices_stack = ee.Image([avi, bi, si]);

Export.image.toDrive({
  image: indices_stack,
  description: 'S2_2017_Indices_AVI_BI_SI',
  scale: 10,
  region: studyarea.geometry().bounds(),
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});
// -------------------------------------------------------------
// 7. Calculate Canopy Density Model (CDM / FCD) - OPTIMIZED
// -------------------------------------------------------------

// Step A: Calculate Min/Max for ALL indices in ONE go (Memory Efficient)
var combinedIndices = ee.Image([avi, bi, si]);

var stats = combinedIndices.reduceRegion({
  reducer: ee.Reducer.minMax(),
  geometry: studyarea,
  scale: 60, // Increased scale slightly to 60m to save memory; won't affect final 10m quality
  maxPixels: 1e10
});

// Step B: Manual Normalization using the shared stats
var avi_n = avi.subtract(ee.Number(stats.get('AVI_min')))
               .divide(ee.Number(stats.get('AVI_max')).subtract(ee.Number(stats.get('AVI_min'))))
               .clamp(0, 1);

var bi_n  = bi.subtract(ee.Number(stats.get('BI_min')))
               .divide(ee.Number(stats.get('BI_max')).subtract(ee.Number(stats.get('BI_min'))))
               .clamp(0, 1);

var si_n  = si.subtract(ee.Number(stats.get('SI_min')))
               .divide(ee.Number(stats.get('SI_max')).subtract(ee.Number(stats.get('SI_min'))))
               .clamp(0, 1);

// Step C: Calculate Vegetation Density (VD)
var vd = avi_n.multiply(ee.Image(1).subtract(bi_n)).sqrt().rename('VD');

// Step D: Calculate the Canopy Density Model (CDM)
var cdm = vd.multiply(si_n).sqrt().multiply(100).rename('CDM');

// Step E: Apply CHM Height Mask
var cdm_masked = cdm.updateMask(chm.gt(2));

// -------------------------------------------------------------
// 8. Display and Export CDM
// -------------------------------------------------------------
Map.addLayer(cdm_masked, {
  min: 0, 
  max: 100, 
  palette: ['#ffffcc', '#c2e699', '#78c679', '#31a354', '#006837']
}, 'Canopy Density Model (%)');

Export.image.toDrive({
  image: cdm_masked,
  description: 'Canopy_Density_Model_2017_2019_Final',
  scale: 10,
  region: studyarea.geometry().bounds(),
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});
