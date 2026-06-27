const response = await fetch("http://localhost:3000/api/db/health");
const json = await response.json();
console.log(JSON.stringify(json, null, 2));
