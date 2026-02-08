async function renderBlueskyFeed(options) {
    const { 
        handle, 
        limit = 5, 
        filter = 'posts_no_replies', // Options: posts_with_replies, posts_no_replies, posts_with_media
        containerId = 'bsky-feed' 
    } = options;

    const endpoint = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=${limit}&filter=${filter}`;

    try {
        const response = await fetch(endpoint);
        const data = await response.json();
        const container = document.getElementById(containerId);

        if (!data.feed) return;

        container.innerHTML = data.feed.map(item => {
            const post = item.post;
            const author = post.author;
            const record = post.record;
            const embed = post.embed;
            
            // Handle Images
            let mediaHtml = '';
            if (embed && embed.$type === 'app.bsky.embed.images#view') {
                mediaHtml = `<div class="bluesky__grid">
                    ${embed.images.map(img => `<img src="${img.thumb}" alt="${img.alt}" class="bluesky__image" />`).join('')}
                </div>`;
            }
            // Handle External Link Cards
            else if (embed && embed.$type === 'app.bsky.embed.external#view') {
                mediaHtml = `
                    <a href="${embed.external.uri}" class="bluesky__card" target="_blank">
                        ${embed.external.thumb ? `<img src="${embed.external.thumb}" class="bluesky__card-thumb" />` : ''}
                        <div class="bluesky__card-content">
                            <strong>${embed.external.title}</strong>
                            <p>${embed.external.description}</p>
                        </div>
                    </a>`;
            }
            // Handle Quote Posts (simple and with media)
            else if (embed && embed.$type === 'app.bsky.embed.record#view') {
                const quotedPost = embed.record;
                const quotedAuthor = quotedPost.author;
                const quotedRecord = quotedPost.value;
                
                let quotedMediaHtml = '';
                // Check if quoted post has embeds (media)
                if (quotedPost.embeds && quotedPost.embeds.length > 0) {
                    const quotedEmbed = quotedPost.embeds[0];
                    
                    // Handle images in quoted post
                    if (quotedEmbed.$type === 'app.bsky.embed.images#view') {
                        quotedMediaHtml = `<div class="bluesky__grid">
                            ${quotedEmbed.images.map(img => `<img src="${img.thumb}" alt="${img.alt}" class="bluesky__image" />`).join('')}
                        </div>`;
                    }
                    // Handle external links in quoted post
                    else if (quotedEmbed.$type === 'app.bsky.embed.external#view') {
                        quotedMediaHtml = `
                            <a href="${quotedEmbed.external.uri}" class="bluesky__card" target="_blank">
                                ${quotedEmbed.external.thumb ? `<img src="${quotedEmbed.external.thumb}" class="bluesky__card-thumb" />` : ''}
                                <div class="bluesky__card-content">
                                    <strong>${quotedEmbed.external.title}</strong>
                                    <p>${quotedEmbed.external.description}</p>
                                </div>
                            </a>`;
                    }
                }
                
                mediaHtml = `
                    <div class="bluesky__quote">
                        <div class="bluesky__quote-header">
                            <img src="${quotedAuthor.avatar}" class="bluesky__quote-avatar" />
                            <div class="bluesky__quote-meta">
                                <strong class="bluesky__quote-name">${quotedAuthor.displayName || quotedAuthor.handle}</strong>
                                <span class="bluesky__quote-handle">@${quotedAuthor.handle}</span>
                            </div>
                        </div>
                        <div class="bluesky__quote-text">${quotedRecord.text}</div>
                        ${quotedMediaHtml}
                    </div>`;
            }

            return `
                <article class="bluesky">
                    <img src="${author.avatar}" class="bluesky__avatar" />
                    <header class="bluesky__header">
                        <div class="bluesky__meta">
                            <a class="bluesky__profile-link" href="https://bsky.app/profile/${author.handle}" target="_blank">
                                <span class="bluesky__name">${author.displayName || author.handle}</span>
                                <span class="bluesky__handle">@${author.handle}</span>
                            </a> • 
                            <a class="bluesky__time-link" href="https://bsky.app/profile/${author.handle}/post/${post.uri.split('/').pop()}" target="_blank">
                                <time>${new Date(post.indexedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                            </a>
                        </div>
                    </header>
                    <div class="bluesky__body">${record.text}</div>
                    ${mediaHtml}
                    <footer class="bluesky__footer">
                        <a class="bluesky__reply-link"href="https://bsky.app/profile/${author.handle}/post/${post.uri.split('/').pop()}" target="_blank">Reply</a>
                        • ${post.likeCount} Likes
                    </footer>
                </article>
            `;
        }).join('');
    } catch (err) {
        console.error("Bluesky Feed Error:", err);
    }
}

// Initialize on your homepage
renderBlueskyFeed({ handle: 'bengammon.co.uk', limit: 3 });