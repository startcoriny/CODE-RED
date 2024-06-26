async function getUserLocation() {
  return new Promise((resolve) => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          const closestRegion = findClosestRegion(userLocation);
          resolve(closestRegion ? closestRegion.roomId : null);
        },
        (error) => {
          console.error('사용자 위치 가져오기 오류:', error);
          resolve(null);
        },
      );
    } else {
      console.error('Geolocation이 지원되지 않습니다.');
      resolve(null);
    }
  });
}

function findClosestRegion(userLocation) {
  // 지역 데이터
  const regions = [
    {
      roomId: '1',
      name: '도심권',
      bounds: { lat: 37.5729, lon: 126.9794 },
    }, // 종로구
    {
      roomId: '1',
      name: '도심권',
      bounds: { lat: 37.5641, lon: 126.997 },
    }, // 중구
    {
      roomId: '1',
      name: '도심권',
      bounds: { lat: 37.5311, lon: 126.9814 },
    }, // 용산구

    {
      roomId: '2',
      name: '동북권',
      bounds: { lat: 37.5509, lon: 127.0407 },
    }, // 성동구
    {
      roomId: '2',
      name: '동북권',
      bounds: { lat: 37.5388, lon: 127.0827 },
    }, // 광진구
    {
      roomId: '2',
      name: '동북권',
      bounds: { lat: 37.5744, lon: 127.0395 },
    }, // 동대문구
    {
      roomId: '2',
      name: '동북권',
      bounds: { lat: 37.6065, lon: 127.0927 },
    }, // 중랑구
    {
      roomId: '2',
      name: '동북권',
      bounds: { lat: 37.6109, lon: 127.0273 },
    }, // 성북구
    {
      roomId: '2',
      name: '동북권',
      bounds: { lat: 37.6396, lon: 127.0257 },
    }, // 강북구
    {
      roomId: '2',
      name: '동북권',
      bounds: { lat: 37.6688, lon: 127.0471 },
    }, // 도봉구
    {
      roomId: '2',
      name: '동북권',
      bounds: { lat: 37.655, lon: 127.0778 },
    }, // 노원구

    {
      roomId: '3',
      name: '서북권',
      bounds: { lat: 37.6027, lon: 126.9288 },
    }, // 은평구
    {
      roomId: '3',
      name: '서북권',
      bounds: { lat: 37.5794, lon: 126.9368 },
    }, // 서대문구
    {
      roomId: '3',
      name: '서북권',
      bounds: { lat: 37.5662, lon: 126.9018 },
    }, // 마포구

    {
      roomId: '4',
      name: '서남권',
      bounds: { lat: 37.5271, lon: 126.8561 },
    }, // 양천구
    {
      roomId: '4',
      name: '서남권',
      bounds: { lat: 37.5509, lon: 126.8497 },
    }, // 강서구
    {
      roomId: '4',
      name: '서남권',
      bounds: { lat: 37.4954, lon: 126.8581 },
    }, // 구로구
    {
      roomId: '4',
      name: '서남권',
      bounds: { lat: 37.4574, lon: 126.8956 },
    }, // 금천구
    {
      roomId: '4',
      name: '서남권',
      bounds: { lat: 37.5265, lon: 126.8962 },
    }, // 영등포구
    {
      roomId: '4',
      name: '서남권',
      bounds: { lat: 37.4979, lon: 126.9828 },
    }, // 동작구
    {
      roomId: '4',
      name: '서남권',
      bounds: { lat: 37.4654, lon: 126.9436 },
    }, // 관악구

    {
      roomId: '5',
      name: '동남권',
      bounds: { lat: 37.4761, lon: 127.0376 },
    }, // 서초구
    {
      roomId: '5',
      name: '동남권',
      bounds: { lat: 37.5184, lon: 127.0473 },
    }, // 강남구
    {
      roomId: '5',
      name: '동남권',
      bounds: { lat: 37.5048, lon: 127.1147 },
    }, // 송파구
    {
      roomId: '5',
      name: '동남권',
      bounds: { lat: 37.5499, lon: 127.1465 },
    }, // 강동구
  ];

  let closestRegion = null;
  let closestDistance = Infinity;

  regions.forEach((region) => {
    const { bounds } = region;
    const distance = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      bounds.lat,
      bounds.lon,
    );
    if (distance < closestDistance) {
      closestDistance = distance;
      closestRegion = region;
    }
  });

  return closestRegion;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // 지구의 반지름 (단위: km)
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // 두 지점 사이의 거리 (단위: km)
  return distance;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

document.addEventListener('DOMContentLoaded', () => {
  const socket = io('/chat');

  socket.on('connect', async () => {
    const roomId = await getUserLocation();
    if (roomId) {
      socket.emit('joinRoom', roomId);
    }
  });

  const messageContainer = document.getElementById('message-container');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');

  messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const roomId = await getUserLocation();

    if (roomId) {
      const message = messageInput.value.trim();
      if (message === '') return;

      const clientId = socket.id;
      socket.emit('message', { message, roomId, clientId });
      messageInput.value = '';
    } else {
      console.error('RoomId를 찾을 수 없습니다.');
    }
  });

  socket.on('message', (data) => {
    const messageElement = document.createElement('div');
    messageElement.textContent = data;
    messageContainer.appendChild(messageElement);
    messageContainer.scrollTop = messageContainer.scrollHeight;
  });
});
