/**
 * Calculate and display the absolute post number for each post
 * Uses Ghost Content API to fetch all posts and determine position
 */

export default function initPostNumbers() {
    const postElements = document.querySelectorAll('[data-post-date]');
    
    if (postElements.length === 0) {
        return;
    }

    // Get the site URL from the document
    const siteUrl = window.location.origin;
    
    // Fetch all posts from Ghost Content API
    fetchAllPosts(siteUrl)
        .then(allPosts => {
            if (allPosts.length === 0) {
                return;
            }
            
            // Sort posts by published date (oldest first)
            allPosts.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
            
            // Calculate post numbers for visible posts
            postElements.forEach(element => {
                const postDate = element.getAttribute('data-post-date');
                const postId = element.getAttribute('data-post-id');
                
                // Find the position of this post
                const postNumber = calculatePostNumber(allPosts, postDate, postId);
                
                // Update the DOM
                const numberElement = element.querySelector('.js-post-number');
                if (numberElement && postNumber) {
                    numberElement.textContent = `#${postNumber}`;
                    numberElement.style.opacity = '1';
                }
            });
        })
        .catch(err => {
            console.error('Failed to load post numbers:', err);
        });
}

/**
 * Fetch all posts from Ghost Content API
 */
async function fetchAllPosts(siteUrl) {
    // Get API key from global variable (set in template)
    const apiKey = window.ghostContentApiKey;
    
    if (!apiKey) {
        console.error('Ghost Content API key not found. Please add it to default.hbs');
        return [];
    }
    
    // Use relative API path
    const apiUrl = `/ghost/api/content/posts/`;
    
    let allPosts = [];
    
    try {
        const response = await fetch(`${apiUrl}?key=${apiKey}&limit=all&fields=id,published_at`);
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.posts) {
            allPosts = data.posts;
        }
    } catch (err) {
        console.error('Error fetching posts:', err);
    }
    
    return allPosts;
}

/**
 * Calculate the post number based on published date
 */
function calculatePostNumber(allPosts, postDate, postId) {
    const targetDate = new Date(postDate);
    
    // Count all posts published before or at the same time
    let count = 0;
    for (const post of allPosts) {
        const publishedDate = new Date(post.published_at);
        if (publishedDate <= targetDate) {
            count++;
        }
        // If exact match on date and ID, we've found our position
        if (post.id === postId) {
            break;
        }
    }
    
    return count;
}
