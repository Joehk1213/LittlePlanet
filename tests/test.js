fetch('http://localhost:3000/api/products', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ "name": "測試手提包", "price": 299 })
})
.then(response => response.json())
.then(data => {
    console.log('Product added successfully:', data);
})
.catch(error => {
    console.error('Error adding product:', error);
});