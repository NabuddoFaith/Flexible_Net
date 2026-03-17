// -----------------------------
// 1. Study Area
// -----------------------------
var studyarea = ee.FeatureCollection("projects/ee-faithnabuddo/assets/studyarea");

Map.centerObject(studyarea, 10);

var outline = studyarea.style({
  color: 'yellow',
  fillColor: '00000000',
  width: 2
});
Map.addLayer(outline, {}, 'Study Area Boundary');

// Export study area
Export.table.toDrive({
  collection: studyarea,
  description: 'StudyArea_Vector',
  fileFormat: 'SHP'
});

// -----------------------------
// 2. Sentinel-2 2017 Composite
// -----------------------------
var s2 = ee.ImageCollection("COPERNICUS/S2_SR")
            .filterBounds(studyarea)
            .filterDate('2017-01-01','2017-12-31')
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',10)); // relaxed

// DEBUG: check if data exists
print('Number of images:', s2.size());

// Use median safely
var s2_image = ee.Algorithms.If(
  s2.size().gt(0),
  s2.median(),
  s2.mosaic()
);

s2_image = ee.Image(s2_image).clip(studyarea);

// Select 10m bands (DO NOT force reprojection here)
var s2_10m = s2_image.select(['B2','B3','B4','B8']);

// Display
Map.addLayer(s2_10m,
  {bands:['B4','B3','B2'], min:0, max:3000},
  'Sentinel-2 2017'
);

// Export Sentinel-2 (force resolution HERE instead)
Export.image.toDrive({
  image: s2_10m,
  description: 'Sentinel2_2017_10m',
  scale: 10,
  region: studyarea,
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});

// -----------------------------
// 3. Canopy Height Model (CHM)
// -----------------------------
var chm = ee.Image("NASA/JPL/global_forest_canopy_height_2005")
            .clip(studyarea);

// Only resample (no heavy reprojection)
var chm_resampled = chm.resample('bilinear');

Map.addLayer(chm_resampled,
  {min:0, max:50, palette:['white','yellow','green','darkgreen']},
  'CHM'
);

// Export CHM at 10m
Export.image.toDrive({
  image: chm_resampled,
  description: 'CHM_10m',
  scale: 10,
  region: studyarea,
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});

// -----------------------------
// 4. Vegetation Indices
// -----------------------------
var avi = s2_10m.expression(
  'sqrt((NIR + 1)*(NIR - RED))', {
    'NIR': s2_10m.select('B8'),
    'RED': s2_10m.select('B4')
}).clip(studyarea);

var bi = s2_10m.expression(
  '(RED - NIR)/(RED + NIR)', {
    'NIR': s2_10m.select('B8'),
    'RED': s2_10m.select('B4')
}).clip(studyarea);

var si = s2_10m.expression(
  '(GREEN + RED)/(BLUE + GREEN)', {
    'BLUE': s2_10m.select('B2'),
    'GREEN': s2_10m.select('B3'),
    'RED': s2_10m.select('B4')
}).clip(studyarea);

// Display
Map.addLayer(avi, {min:0, max:5, palette:['white','green']}, 'AVI');
Map.addLayer(bi, {min:-1, max:1, palette:['brown','yellow']}, 'BI');
Map.addLayer(si, {min:0, max:5, palette:['white','black']}, 'SI');

// Export indices
Export.image.toDrive({
  image: avi,
  description: 'AVI_2017',
  scale: 10,
  region: studyarea,
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});

Export.image.toDrive({
  image: bi,
  description: 'BI_2017',
  scale: 10,
  region: studyarea,
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});

Export.image.toDrive({
  image: si,
  description: 'SI_2017',
  scale: 10,
  region: studyarea,
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});
