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
