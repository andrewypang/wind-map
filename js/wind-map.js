var ZOOM = 6;
var DAMPING = 0.3;
var MAX_WINDSPEED;
var MIN_WINDSPEED;


var map;
var gridBounds;
var request;
var grid = [];
var openWeatherMapKey = config.API_KEY_OPENWEATHERMAP;

var dataset_stations = [];
var dataset_interpolatedWinds = [];
var heatmap;
var stationWindsLayer = [];
var interpolatedWindsLayer = [];
var streamlineLayer = [];

var stationWindColorRange = ['#0000ff','#5300f0','#7400e0','#8d00cf','#a000bd','#b300a8','#c30093','#d0007d','#de0065','#ea004c','#f50030','#ff0000'];

function loadMaxMinWindSpeedFromDataset()
{
  // Find max and min wind speeds from both stations measurements and interpolated winds
  if(dataset_stations === undefined || dataset_stations.length == 0)
  {
    console.log("Can not find max/min wind speed")
  }
  else
  {
    MAX_WINDSPEED = MIN_WINDSPEED = dataset_stations[0].wind.speed;
    for(var i = 0; i < dataset_stations.length; i++)
    {
      var currentSpeed = dataset_stations[i].wind.speed;

      MIN_WINDSPEED = (currentSpeed < MIN_WINDSPEED ? currentSpeed : MIN_WINDSPEED);
      MAX_WINDSPEED = (currentSpeed > MAX_WINDSPEED ? currentSpeed : MAX_WINDSPEED);
    }
    for(var i = 0; i < dataset_interpolatedWinds.length; i++)
    {
      var currentSpeed = dataset_interpolatedWinds[i].wind.speed;

      MIN_WINDSPEED = (currentSpeed < MIN_WINDSPEED ? currentSpeed : MIN_WINDSPEED);
      MAX_WINDSPEED = (currentSpeed > MAX_WINDSPEED ? currentSpeed : MAX_WINDSPEED);
    }
  }
}


function VelocityMagScale(num)
{
  var out_min = 0;
  var out_max = stationWindColorRange.length-1;

  loadMaxMinWindSpeedFromDataset();

  return (num - MIN_WINDSPEED) * (out_max - out_min) / (MAX_WINDSPEED - MIN_WINDSPEED) + out_min;
}

function toRadians (angle) {
  return angle * (Math.PI / 180);
}

function drawStations() {
  // Draw Stations
  if(dataset_stations.length == 0)
  {
    console.log("Dataset Station Empty!")
  }
  for(var i = 0; i < dataset_stations.length; i++)
  {
    var lat = dataset_stations[i].coord.Lat;
    var lng = dataset_stations[i].coord.Lon;
    var station_coord = new google.maps.LatLng(lat, lng);

    new google.maps.Marker({position: station_coord, map: map});
  }
}

function findWindEndPoint(sourcePoint, directionInDegrees, mag) {
  // Input: sourcePoint as LatLng() class
  // Output: LatLng()
  // Lat should be X
  // Lng should be Y

  var dx = mag*Math.cos(toRadians(directionInDegrees));
  var dy = mag*Math.sin(toRadians(directionInDegrees));

  // Apply damping so wind arrows aren't so long
  dy *= DAMPING;
  dx *= DAMPING;

  var newLat = (sourcePoint.lat() - dx);
  var newLng = (sourcePoint.lng() - dy);

  var head = new google.maps.LatLng(newLat, newLng);

  return head;

}

function drawArrowTailToHead(tail, head, color) {
  // Define a symbol using a predefined path (an arrow)
  var lineSymbol = {
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW
  };

  var arrow = new google.maps.Polyline({
    path: [tail, head],
    icons: [{
      icon: lineSymbol,
      offset: '100%'
    }],
    strokeWeight: "2",
    strokeOpacity: "0.8",
    strokeColor: color,
    map: null
  });

  return arrow;

}

function loadStationWinds() {
  // Draw wind vector for each station
  // Check if dataset of stations is empty
  if(dataset_stations.length == 0)
  {
    console.log("Dataset Station Empty!")
  }
  else
  {
    for(var i = 0; i < dataset_stations.length; i++)
    {
      // Parse OpenWeatherMap API Data to my dataset
      var lat = dataset_stations[i].coord.Lat;
      var lng = dataset_stations[i].coord.Lon;
      var windStation = new google.maps.LatLng(lat, lng);

      var windSpeed = dataset_stations[i].wind.speed;
      var windDeg = dataset_stations[i].wind.deg;

      var windStationEndPoint = findWindEndPoint(windStation, windDeg, windSpeed);

      var color = stationWindColorRange[ Math.round(VelocityMagScale(windSpeed)) ];

      stationWindsLayer.push(drawArrowTailToHead(windStation, windStationEndPoint, color));
    }
  }
}



function findInterpolateEndPointViaShepardsMethod(pointToInterpolate){
  // pointToInterpolate is a LatLng Class
  // output is JSON
  // returns the end point(head end) of the pointToInterpolate
  // end point(head end) must consider all points in dataset_stations

  function weight(i, unknownPoint){
    var powerParameter = 2.0;
    var knownPoint = new google.maps.LatLng(dataset_stations[i].coord.Lat, dataset_stations[i].coord.Lon);
    var distance = Math.pow(google.maps.geometry.spherical.computeDistanceBetween(unknownPoint, knownPoint), powerParameter);

    return parseFloat(1.0/distance);
  }

  // X-direction & Y-direction
  var sumNumerator_x = 0;
  var sumDenom_x = 0;
  var sumNumerator_y = 0;
  var sumDenom_y = 0;

  for(var i = 0; i < dataset_stations.length; i++)
  {
    var stationInJSON = dataset_stations[i];
    var stationWindDeg = stationInJSON.wind.deg; // North == 0; East == 90 
    var stationWindSpeed = stationInJSON.wind.speed;

    var x = stationWindSpeed*Math.cos(toRadians(stationWindDeg));
    var y = stationWindSpeed*Math.sin(toRadians(stationWindDeg));

    sumNumerator_x += weight(i, pointToInterpolate) * x;
    sumDenom_x += weight(i, pointToInterpolate);

    sumNumerator_y += weight(i, pointToInterpolate) * y;
    sumDenom_y += weight(i, pointToInterpolate);
  }
  var dx = parseFloat(sumNumerator_x/sumDenom_x);
  var dy = parseFloat(sumNumerator_y/sumDenom_y);

  if(isNaN(dx) || isNaN(dy))
  {
    console("Error: findInterpolateEndPointViaShepardsMethod");
  }
  else
  {
    var newInterpolatedWindPointMag = Math.sqrt((dx*dx)+(dy*dy));
    var newInterpolatedWindPointDeg = Math.atan2(dy,dx);
    newInterpolatedWindPointDeg = newInterpolatedWindPointDeg * 180 / Math.PI;
    // Compute which quad newInterpolatedWindPointDeg is pointing at
    if(0 > newInterpolatedWindPointDeg && newInterpolatedWindPointDeg > -90)
    {
      newInterpolatedWindPointDeg += 360;
    }
    else if(-180 < newInterpolatedWindPointDeg && newInterpolatedWindPointDeg < -90)
    {
      newInterpolatedWindPointDeg += 360;
    }

    // Convert data to JSON
    var interpolateWindInJSON = {
      "coord":{"Lat":pointToInterpolate.lat(),"Lon":pointToInterpolate.lng()},
      "wind":{"speed":newInterpolatedWindPointMag,"deg":newInterpolatedWindPointDeg} 
    };

    return interpolateWindInJSON;

  }
}

function loadInterpolateWinds() {
  // https://en.wikipedia.org/wiki/Inverse_distance_weighting

  // Use grid points as interpolate points
  var interpolateWinds = grid.slice();


  // Get interpolate wind points, compute, and store into dataset
  for(var i = 0; i < interpolateWinds.length; i++)
  {
    var interpolateWindInJSON = findInterpolateEndPointViaShepardsMethod(interpolateWinds[i]);

    dataset_interpolatedWinds.push(interpolateWindInJSON);
  }

  // Draw wind for each interpolation point
  for(var i = 0; i < dataset_interpolatedWinds.length; i++)
  {
    var lat = dataset_interpolatedWinds[i].coord.Lat;
    var lng = dataset_interpolatedWinds[i].coord.Lon;
    var tail = new google.maps.LatLng(lat, lng);

    var windSpeed = dataset_interpolatedWinds[i].wind.speed;
    var windDeg = dataset_interpolatedWinds[i].wind.deg;
    var head = findWindEndPoint(tail, windDeg, windSpeed);

    var color = stationWindColorRange[ Math.round(VelocityMagScale(windSpeed)) ];

    var lineSymbol = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW
    };

    var wind_vector = new google.maps.Polyline({
      path: [tail, head],
      icons: [{
        icon: lineSymbol,
        offset: '100%'
      }],
      strokeColor: "#a143ff",
      strokeWeight: "2",
      strokeOpacity: 0.5,
      strokeColor: color,
      map: null
    });

    interpolatedWindsLayer.push(wind_vector);
  }

}

function loadStreamlines() {
  var numOfSteps = 10;
  var streamlineWinds = grid.slice();
  var streamlineCoords = [];

  // For each interpolate point
  for(var i = 0; i < streamlineWinds.length; i++)
  {
    var ForwardStreamlineCoordsForEachLine = [];
    var BackwardStreamlineCoordsForEachLine = [];
    var basePtInJSON = findInterpolateEndPointViaShepardsMethod(streamlineWinds[i]); //RETURNS IN JSON
    var basePtInLatLng = new google.maps.LatLng(basePtInJSON.coord.Lat, basePtInJSON.coord.Lon); // Convert into LatLng

    var newPtForwardSide = findWindEndPoint(basePtInLatLng, basePtInJSON.wind.deg, basePtInJSON.wind.speed);
    ForwardStreamlineCoordsForEachLine.push(basePtInLatLng);

    var newPtBackwardSide = findWindEndPoint(basePtInLatLng, (basePtInJSON.wind.deg + 180)%360, basePtInJSON.wind.speed);
    BackwardStreamlineCoordsForEachLine.push(basePtInLatLng);

    for(var j = 0; j < 200; j++)
    {
      var forwardBasePtInJSON = findInterpolateEndPointViaShepardsMethod(ForwardStreamlineCoordsForEachLine[j]);
      var forwardBasePtInLatLng = new google.maps.LatLng(forwardBasePtInJSON.coord.Lat, forwardBasePtInJSON.coord.Lon);
      var newForwardPt = findWindEndPoint(forwardBasePtInLatLng, forwardBasePtInJSON.wind.deg, forwardBasePtInJSON.wind.speed);
      var forwardColor = stationWindColorRange[ Math.round(VelocityMagScale(forwardBasePtInJSON.wind.speed)) ];


      var backwardBasePtInJSON = findInterpolateEndPointViaShepardsMethod(BackwardStreamlineCoordsForEachLine[j]);
      var backwardBasePtInLatLng = new google.maps.LatLng(backwardBasePtInJSON.coord.Lat, backwardBasePtInJSON.coord.Lon);
      var newBackwardPt = findWindEndPoint(backwardBasePtInLatLng, (backwardBasePtInJSON.wind.deg + 180)%360, backwardBasePtInJSON.wind.speed);
      var backwardColor = stationWindColorRange[ Math.round(VelocityMagScale(backwardBasePtInJSON.wind.speed)) ];

      var forwardLineSymbol = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW
      };

      var backwardLineSymbol = {
        path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW
      };

      var ForwardArrow = new google.maps.Polyline({
          path: [forwardBasePtInLatLng, newForwardPt],
          strokeWeight: "2",
          strokeOpacity: "0.5",
          strokeColor: forwardColor,
          icons: [{
            icon: (j % 10) == 0 ? forwardLineSymbol : null,
            offset: '50%'
          }],
          map: null
        });

      var BackwardArrow = new google.maps.Polyline({
          path: [backwardBasePtInLatLng, newBackwardPt],
          strokeWeight: "2",
          strokeOpacity: "0.5",
          strokeColor: backwardColor,
          icons: [{
            icon: (j == 10) ? backwardLineSymbol : null,
            offset: '50%'
          }],
          map: null
        });

      if(gridBounds.contains(newForwardPt) && gridBounds.contains(newBackwardPt))
      {
        ForwardStreamlineCoordsForEachLine.push(newForwardPt);
        BackwardStreamlineCoordsForEachLine.push(newBackwardPt);
        
        streamlineLayer.push(ForwardArrow);
        streamlineLayer.push(BackwardArrow);

      }
      else if(gridBounds.contains(newForwardPt) && !gridBounds.contains(newBackwardPt))
      {
        // back not inside box so push forward
        ForwardStreamlineCoordsForEachLine.push(newForwardPt);
        BackwardStreamlineCoordsForEachLine.push(backwardBasePtInLatLng);
        streamlineLayer.push(ForwardArrow);
      }
      else if(!gridBounds.contains(newForwardPt) && gridBounds.contains(newBackwardPt))
      {
        // back not inside box so push forward
        ForwardStreamlineCoordsForEachLine.push(forwardBasePtInLatLng);
        BackwardStreamlineCoordsForEachLine.push(newBackwardPt);
        streamlineLayer.push(BackwardArrow);
      }
      else
      {
        break;
      }
    }
  }
}

function drawHeatMap() {
  var heatmapData = [];

  for(var i = 0; i < dataset_stations.length; i++)
  {
    // Add station data to heat map
    heatmapData.push({location: new google.maps.LatLng(dataset_stations[i].coord.Lat,dataset_stations[i].coord.Lon), weight: dataset_stations[i].wind.speed});
  }

  for(var i = 0; i < dataset_interpolatedWinds.length; i++)
  {
    // Add interpolated wind data to heat map
    heatmapData.push({location: new google.maps.LatLng(dataset_interpolatedWinds[i].coord.Lat,dataset_interpolatedWinds[i].coord.Lon), weight: dataset_interpolatedWinds[i].wind.speed});
  }

  heatmap = new google.maps.visualization.HeatmapLayer({
    data: heatmapData,
    radius: 50,
    dissipating: true,
  });
  heatmap.setMap(map);

}

function toggleHeatmap() {
  heatmap.setMap(heatmap.getMap() ? null : map);
}

function toggleStationWind() {
  clearToggle();
  for(var i = 0; i < stationWindsLayer.length; i++)
  {
    stationWindsLayer[i].setMap(stationWindsLayer[i].getMap() ? null : map);
  }
}

function toggleArrowPlot() {
  clearToggle();
  for(var i = 0; i < interpolatedWindsLayer.length; i++)
  {
    interpolatedWindsLayer[i].setMap(interpolatedWindsLayer[i].getMap() ? null : map);
  }
}

function toggleStreamline() {
  clearToggle();
  for(var i = 0; i < streamlineLayer.length; i++)
  {
    streamlineLayer[i].setMap(streamlineLayer[i].getMap() ? null : map);
  }
}

function clearToggle() {
  for(var i = 0; i < stationWindsLayer.length; i++)
  {
    stationWindsLayer[i].setMap(null);
  }
  for(var i = 0; i < interpolatedWindsLayer.length; i++)
  {
    interpolatedWindsLayer[i].setMap(null);
  }
  for(var i = 0; i < streamlineLayer.length; i++)
  {
    streamlineLayer[i].setMap(null);
  }
}

function initMap() {

  // Get Grid Coords
  // UL--UR
  // |    |
  // BL--BR

  var UL = new google.maps.LatLng({lat: 42.000, lng: -124.409});
  var UR = new google.maps.LatLng({lat: 42.000, lng: -114.020});
  var BL = new google.maps.LatLng({lat: 32.534, lng: -124.409});
  var BR = new google.maps.LatLng({lat: 32.534, lng: -114.020});

  gridBounds = new google.maps.LatLngBounds(BL,UR);

  var centerOfGrid = gridBounds.getCenter();

  map = new google.maps.Map(document.getElementById('map'), {
    center: centerOfGrid,
    zoom: ZOOM,
    minZoom: 5,
    maxZoom: ZOOM,
    draggable: true

  });

  var dx = parseFloat( (UL.lng() - UR.lng()) / 10.0);
  var dy = parseFloat( (UL.lat() - BL.lat()) / 10.0);

  for(var y = 0; y < 11; y++)
  {
    for(var x = 0; x < 11; x++)
    {
      var newLat = parseFloat(UL.lat() - y*dy);
      var newLng = parseFloat(UL.lng() - x*dx);

      var newCoord = new google.maps.LatLng(newLat,newLng);
      grid.push(newCoord);
    }
  }

  // Draw Grid
  for(var i = 0; i < 11; i++)
  {
    // Draw Horizonal Lines
    new google.maps.Polyline({
      path: [ grid[i*11], grid[i*11+10] ],
      map: map,
      strokeColor: "#000000",
      strokeOpacity: 0.3,
      strokeWeight: 2
    });

    // Draw Vertical Lines
    new google.maps.Polyline({
      path: [ grid[i], grid[i+110] ],
      map: map,
      strokeColor: "#000000",
      strokeOpacity: 0.3,
      strokeWeight: 2
    });

  }

  var requestString = "http://api.openweathermap.org/data/2.5/box/city?bbox=" 
  + UL.lng() + "," + UL.lat() + ","
  + BR.lng() +  "," + BR.lat() + ","
  + "7"
  + "&cluster=yes&format=json"
  + "&APPID=" + openWeatherMapKey;

// Error 400: "Requested area is larger than allowed for your account type (25.00 square degrees)"
// https://openweathermap.desk.com/customer/portal/questions/17572511-error-requested-area-is-larger-than-allowed-for-your-account-type-25-square-degrees-

  // Create a request variable and assign a new XMLHttpRequest object to it.
  var request = new XMLHttpRequest();

  // Open a new connection, using the GET request on the URL endpoint
  request.open("GET", requestString, true);

  request.onload = function(){
    if (this.readyState == 4 && this.status == 200)
    {

      // Begin accessing JSON data here
      var results = JSON.parse(this.responseText);

      //Process Data from OpenWeatherMap API to Google MAPs API

      // Parse results from API into my settings (i.e. clone results to my dataset)
      // wind.speed => Unit Default: meter/sec, Metric: meter/sec, Imperial: miles/hour.
      // wind.deg => direction of wind coming FROM ... in degrees (meteorological) => http://snowfence.umn.edu/Components/winddirectionanddegreeswithouttable3.htm
      dataset_stations = results.list.slice();

      //drawStations();

      loadStationWinds();

      loadInterpolateWinds();

      loadStreamlines();

      drawHeatMap();

    }
    else
    {
      console.error(this.statusText);
    }
  };   
  request.onerror = function(){
    console.error(this.statusText);
  };
  request.send();


}