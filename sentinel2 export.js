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
    .filterDate('2017-01-01', '2017-12-31')
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
