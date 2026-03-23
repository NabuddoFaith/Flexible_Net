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
