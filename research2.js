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
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',10));

print('Number of images:', s2.size());

var s2_image = ee.Algorithms.If(
  s2.size().gt(0),
  s2.median(),
  s2.mosaic()
);

s2_image = ee.Image(s2_image).clip(studyarea);

var s2_10m = s2_image.select(['B2','B3','B4','B8']);

Map.addLayer(s2_10m,
  {bands:['B4','B3','B2'], min:0, max:3000},
  'Sentinel-2 2017'
);

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

// -----------------------------
// 4. Vegetation Indices (FIXED)
// -----------------------------

var s2_scaled = s2_10m.divide(10000);

var nir = s2_scaled.select('B8');
var red = s2_scaled.select('B4');
var green = s2_scaled.select('B3');
var blue = s2_scaled.select('B2');

// AVI
var avi = nir.subtract(red)
              .max(0)
              .multiply(nir.add(1))
              .sqrt()
              .rename('AVI')
              .clip(studyarea);

// BI
var bi = red.subtract(nir)
            .divide(red.add(nir))
            .rename('BI')
            .clip(studyarea);

// SI
var si = red.add(green)
            .divide(blue.add(green))
            .rename('SI')
            .clip(studyarea);

// Dynamic stretch for AVI
var stats = avi.reduceRegion({
  reducer: ee.Reducer.percentile([2, 98]),
  geometry: studyarea,
  scale: 10,
  maxPixels: 1e9
});

var minAVI = ee.Number(stats.get('AVI_p2')).getInfo();
var maxAVI = ee.Number(stats.get('AVI_p98')).getInfo();

Map.addLayer(avi, {
  min: minAVI,
  max: maxAVI,
  palette: ['white','yellow','green','darkgreen']
}, 'AVI (Stretched)');

Map.addLayer(bi, {
  min: -1, max: 1,
  palette: ['brown','yellow']
}, 'BI');

Map.addLayer(si, {
  min: 0, max: 2,
  palette: ['white','black']
}, 'SI');

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

// -----------------------------
// 5. NDVI
// -----------------------------
var ndvi = s2_scaled.normalizedDifference(['B8','B4'])
                    .rename('NDVI')
                    .clip(studyarea);

Map.addLayer(ndvi, {
  min: -1, max: 1,
  palette: ['blue','white','green']
}, 'NDVI 2017');

Export.image.toDrive({
  image: ndvi,
  description: 'NDVI_2017',
  scale: 10,
  region: studyarea,
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});

// -----------------------------
// 6. Canopy Density Model (CDM)
// -----------------------------

// Normalize layers
var avi_norm = avi.unitScale(minAVI, maxAVI);
var si_norm = si.unitScale(0, 2);
var chm_norm = chm_resampled.unitScale(0, 50);

// Combine
var cdm = avi_norm
            .add(si_norm)
            .add(chm_norm)
            .divide(3)
            .rename('CDM')
            .clip(studyarea);

Map.addLayer(cdm, {
  min: 0, max: 1,
  palette: ['white','yellow','green','darkgreen']
}, 'Canopy Density Model');

Export.image.toDrive({
  image: cdm,
  description: 'CDM_2017',
  scale: 10,
  region: studyarea,
  fileFormat: 'GeoTIFF',
  maxPixels: 1e10
});

// -----------------------------
// END
// -----------------------------
